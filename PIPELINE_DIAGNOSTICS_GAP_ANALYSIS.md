# Pipeline-Diagnostik-Feature-Lücke: `pipelineTimeouts` / `AGENT_SUITE_TIMEOUT` (Analyse, kein Patch)

## Befund

`trading-bot-v24.6-runtime.mjs` führt Buchhaltung über den Signal-Pipeline-Verlauf
pro Symbol (`recordSignalPipelineStage`) und schützt den einzigen potenziell
langsamen Schritt - `agentSuite.evaluate()` im Post-Gate-Pfad - explizit mit
einem 3-Sekunden-Timeout:

```js
const agentEvaluation = await pipelineWithTimeout(() => agentSuite.evaluate({...}), 3000, 'AGENT_SUITE_TIMEOUT');
```

Schlägt dieser Timeout zu (oder wird der Kandidat aus einem anderen Grund aus
der Pipeline verworfen), zählt v24.6 das in `scanStats.pipelineTimeouts` bzw.
`scanStats.pipelineRejected` mit und loggt am Ende jedes Scans eine
`[SCAN-DIAGNOSTICS-PIPELINE]`-Zeile mit Stufen-Aufschlüsselung.

`trading-bot-v25-marketdata-fixed.mjs` ruft an der äquivalenten Stelle
`agentSuite.evaluate()` **ungeschützt** auf (kein `pipelineWithTimeout`,
kein `AGENT_SUITE_TIMEOUT`-Fehlercode, keine `pipelineTimeouts` /
`pipelineStages` / `pipelineRejected`-Zähler, kein
`[SCAN-DIAGNOSTICS-PIPELINE]`-Log). Kein Test im Repo prüft dieses Feature
aktuell.

## Produktionsrelevanz

- **Realer Fehlerfall statt rein hypothetisch:** `agentSuite.evaluate()` liest
  u.a. Modell-Statistiken (`mlModel.getStats()`, `modelDriftMonitor.status()`)
  und in v24.6 zusätzlich Performance-Statistiken aus der DB
  (`getPeriodPerformanceStats`). Ein einzelner hängender DB-/IO-Call in einem
  dieser Pfade blockiert in v25 aktuell den gesamten Scan-Kandidaten ohne
  oberes Zeitlimit auf dieser Ebene - begrenzt nur noch durch den äußeren
  `MARKET_DATA_BUNDLE_TIMEOUT_MS`-Timeout der Marktdaten-Stufe, der thematisch
  nicht dafür gedacht ist und die Agent-Stufe nicht abdeckt.
- **Fail-fast-Prinzip durchbrochen:** v25 verfolgt an anderer Stelle konsequent
  das Prinzip "einzelner Kandidat darf den Scan nicht blockieren" (z.B.
  `asyncPool`-Konkurrenzbegrenzung, `getMarketDataBundle`-Timeout-Race). Der
  fehlende Timeout um `agentSuite.evaluate()` ist eine Lücke in genau diesem
  Prinzip.
- **Beobachtbarkeit fehlt:** Ohne `pipelineTimeouts`/`pipelineStages` gibt es
  in v25 kein Signal dafür, *warum* ein Kandidat die Agent-Stufe nie erreicht
  oder dort hängen bleibt - Operator:innen sehen nur einen stillen Rückgang
  der Signalrate, ohne Diagnose-Hinweis in den Logs.

## Einschätzung

Das Feature ist **produktiv relevant** und die Lücke ist wahrscheinlich ein
unbeabsichtigter Verlust beim v24.6→v25-Refactor (die Timeout-Hülle
existiert nirgends mehr im gesamten v25-File, nicht nur an dieser Stelle),
kein bewusster Architekturwechsel wie bei `evaluateCentralDirectionGates` →
`evaluateDirectionGates`.

Gleichzeitig ist der Umfang eines korrekten Fixes nicht trivial: er würde
(a) eine `pipelineWithTimeout`-Hilfsfunktion (oder Äquivalent) in v25
nachziehen, (b) `scanStats`-Felder erweitern, (c) den bestehenden
Diagnose-Log-String (`[SCAN-DIAGNOSTICS]`) um eine zweite
`[SCAN-DIAGNOSTICS-PIPELINE]`-Zeile ergänzen, und (d) einen sinnvollen
Timeout-Wert für v25s aktuelle Aufrufsignatur von `agentSuite.evaluate()`
festlegen (die sich von der v24.6-Signatur bereits unterscheidet, siehe
`expectancy`/`sharpe`, die in v25 an keiner Aufrufstelle mehr übergeben
werden). Das ist eine eigenständige, nicht-triviale Änderung mit eigenem
Testbedarf - explizit außerhalb des Umfangs dieses Patches, wie in Punkt 4
der Aufgabenstellung vorgegeben. Empfehlung: als eigenes Ticket nachziehen.


## Nacharbeit v25.0.16 — PRE_GATE-Agent-Telemetrie und Timeout-Impact

### Performance-Bewertung der PRE_GATE-Telemetrie

`agentSuite.evaluate()` ist in der aktuellen Agent-Suite synchron und führt deterministische In-Memory-Berechnungen aus. Es wurden keine MongoDB-Abfragen, Dateizugriffe oder Netzwerkzugriffe im eigentlichen `evaluate()`-Pfad festgestellt.

Bei `config.SCAN_CONCURRENCY` und einer dynamischen Watchlist von bis zu `TOP_COIN_LIMIT` Kandidaten kann die zusätzliche PRE_GATE-Auswertung dennoch CPU-Zeit hinzufügen. Da der Code synchron ausgeführt wird, bedeutet höhere Scan-Konkurrenz nicht echte CPU-Parallelität; bei vielen Kandidaten kann die zusätzliche Auswertung die Scan-Laufzeit messbar erhöhen. Eine zusätzliche DB-Last ist aus dem `evaluate()`-Pfad dagegen nicht zu erwarten.

Ein Ergebnis-Cache zwischen PRE_GATE und Post-Gate wäre grundsätzlich möglich, wurde aber bewusst nicht umgesetzt: Die Auswertungen können unterschiedliche Eingabeparameter erhalten, insbesondere die Richtung. Ein Cache wäre nur bei exakt identischer Eingabemenge und einem bewusst definierten Snapshot-Zeitpunkt risikoarm.

### Timeout-Grenze

Der Post-Gate-Aufruf von `agentSuite.evaluate()` ist mit `pipelineWithTimeout(..., 3000, 'AGENT_SUITE_TIMEOUT')` abgesichert. Damit wird verhindert, dass ein künftig asynchron werdender Agent-Suite-Pfad die Pipeline unbegrenzt blockiert. Der Timeout kann einen bereits laufenden synchronen JavaScript-Block nicht hart unterbrechen; er schützt insbesondere Promise-/async-Ausführungen.
