'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');
const {
  indexPaperOrders,
  indexExecutionIntents,
  indexExecutionEvents,
  findExactPaperOrder,
  findExactExecutionSource,
  recoverTrade
} = require('../ml-history-recovery');

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');

const APPLY = process.argv.includes('--apply');
const LIMIT = Number(process.env.ML_RECOVERY_LIMIT || 2000);

async function main() {
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE || 'tradingBotDB';
    const db = client.db(dbName);

    const closed = db.collection('closedTrades');
    const paperOrders = db.collection('paperOrders');
    const executionIntents = db.collection('executionIntents');
    const executionEvents = db.collection('executionEvents');

    const trades = await closed.find({
      isPartial: { $ne: true },
      pnlUSD: { $exists: true, $ne: null }
    }).sort({ closeTime: -1 }).limit(LIMIT).toArray();

    const [orders, intents, events] = await Promise.all([
      paperOrders.find({}).sort({ simulatedAt: 1 }).limit(Math.max(LIMIT * 2, 5000)).toArray(),
      executionIntents.find({}).sort({ createdAt: 1 }).limit(Math.max(LIMIT * 2, 5000)).toArray(),
      executionEvents.find({}).sort({ createdAt: 1, sequence: 1 }).limit(Math.max(LIMIT * 5, 10000)).toArray()
    ]);

    const paperIndex = indexPaperOrders(orders);
    const intentIndex = indexExecutionIntents(intents);
    const eventIndex = indexExecutionEvents(events);

    let eligible = 0;
    let recoverable = 0;
    let updated = 0;
    let unresolved = 0;
    let recoveredFromPaperOrders = 0;
    let recoveredFromExecutionEvents = 0;

    console.log(
      `[ML-RECOVERY] trades=${trades.length} paperOrders=${orders.length} ` +
      `executionIntents=${intents.length} executionEvents=${events.length} ` +
      `mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`
    );

    for (const trade of trades) {
      const missingPrice =
        !(Number.isFinite(Number(trade.signalPriceAtEntry)) && Number(trade.signalPriceAtEntry) > 0);
      const missingEntry =
        !(Number.isFinite(Number(trade.entry)) && Number(trade.entry) > 0);

      if (!missingPrice && !missingEntry) continue;
      eligible++;

      const paperMatch = findExactPaperOrder(trade, paperIndex);
      const executionMatch = paperMatch.order
        ? { intent: null, event: null, source: null, sourceId: null }
        : findExactExecutionSource(trade, intentIndex, eventIndex);

      if (!paperMatch.order && !executionMatch.event && !executionMatch.intent) {
        unresolved++;
        continue;
      }

      const { patch, reasons } = recoverTrade(
        trade,
        paperMatch.order,
        executionMatch
      );

      if (!Object.keys(patch).length) {
        unresolved++;
        continue;
      }

      recoverable++;

      if (paperMatch.order) recoveredFromPaperOrders++;
      else recoveredFromExecutionEvents++;

      if (APPLY) {
        const result = await closed.updateOne(
          { _id: trade._id },
          { $set: patch }
        );
        updated += result.modifiedCount;
      }

      console.log(
        `[ML-RECOVERY] ${trade._id} ${trade.symbol || ''} ` +
        `${reasons.join(', ')}${APPLY ? ' [APPLIED]' : ''}`
      );
    }

    const summary = {
      mode: APPLY ? 'APPLY' : 'DRY-RUN',
      scanned: trades.length,
      eligible,
      recoverable,
      updated,
      unresolved,
      recoveredFromPaperOrders,
      recoveredFromExecutionEvents
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!APPLY) {
      console.log('[ML-RECOVERY] Kein DB-Write. Zum Anwenden erneut mit --apply starten.');
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(`[ML-RECOVERY] FAILED: ${err.stack || err.message}`);
  process.exitCode = 1;
});
