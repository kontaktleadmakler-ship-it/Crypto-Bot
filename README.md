# Crypto Bot Optimized (v2.0)

Ein vollständig überarbeiteter, robuster modularer Trading-Signal-Bot.

## Verbesserungen in Version 2.0:
1. **Robuste Fehlerbehandlung:** Try/Catch und Retry-Logik bei simulierten oder realen API-Datenabrufen.
2. **Speicherlecks behoben:** Pufferung über Sliding Windows (`maxHistorySize`).
3. **Mathematische Sicherheit:** Strenge Vermeidung von Division durch Null (`NaN`-Prüfungen).
4. **Modulare Struktur:** Trennung von Core-Engine, Makro-Filtern, Volatilitäts-Oberfläche, Order-Flow und Hedge-Management.
5. **Konfigurierbarkeit:** Vollständig anpassbar über Umgebungsvariablen (`.env`).

## Installation & Start
```bash
npm install
npm start
```
