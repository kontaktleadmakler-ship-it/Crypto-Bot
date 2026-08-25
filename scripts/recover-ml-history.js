'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { indexPaperOrders, findExactPaperOrder, recoverTrade } = require('../ml-history-recovery');

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');

const APPLY = process.argv.includes('--apply');
const LIMIT = Number(process.env.ML_RECOVERY_LIMIT || 2000);

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const dbName = process.env.MONGODB_DB_NAME || process.env.MONGODB_DATABASE || 'crypto_bot';
    const db = client.db(dbName);
    const closed = db.collection('closedTrades');
    const paperOrders = db.collection('paperOrders');

    const trades = await closed.find({
      isPartial: { $ne: true },
      pnlUSD: { $exists: true, $ne: null }
    }).sort({ closeTime: -1 }).limit(LIMIT).toArray();

    const orders = await paperOrders.find({}).limit(Math.max(LIMIT * 2, 5000)).toArray();
    const indexes = indexPaperOrders(orders);

    let eligible = 0;
    let recoverable = 0;
    let updated = 0;
    let ambiguous = 0;
    let unresolved = 0;

    console.log(`[ML-RECOVERY] trades=${trades.length} paperOrders=${orders.length} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);

    for (const trade of trades) {
      const missingPrice = !Number.isFinite(Number(trade.signalPriceAtEntry)) || Number(trade.signalPriceAtEntry) <= 0;
      const missingEntry = !Number.isFinite(Number(trade.entry)) || Number(trade.entry) <= 0;
      if (!missingPrice && !missingEntry) continue;
      eligible++;

      const match = findExactPaperOrder(trade, indexes);
      if (!match.order) {
        unresolved++;
        continue;
      }

      const { patch, reasons } = recoverTrade(trade, match.order);
      if (!Object.keys(patch).length) continue;
      recoverable++;

      if (APPLY) {
        const result = await closed.updateOne(
          { _id: trade._id },
          { $set: patch }
        );
        updated += result.modifiedCount;
      }

      console.log(`[ML-RECOVERY] ${trade._id} ${trade.symbol || ''} ${reasons.join(', ')}`);
    }

    console.log(JSON.stringify({
      mode: APPLY ? 'APPLY' : 'DRY-RUN',
      scanned: trades.length,
      eligible,
      recoverable,
      updated,
      unresolved,
      ambiguous
    }, null, 2));

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
