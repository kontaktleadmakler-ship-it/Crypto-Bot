import json
import os
import sys
import numpy as np

MODEL_NAME = os.getenv('TIMESFM_MODEL', 'google/timesfm-2.5-200m-transformers')

try:
    import torch
    from transformers import TimesFm2_5ModelForPrediction
    MODEL = TimesFm2_5ModelForPrediction.from_pretrained(MODEL_NAME, device_map='auto')
    MODEL = MODEL.eval()
    print(json.dumps({'ready': True, 'model': MODEL_NAME}), flush=True)
except Exception as exc:
    print(json.dumps({'ready': False, 'error': f'{type(exc).__name__}: {exc}'}), flush=True)
    sys.exit(2)

def forecast(req):
    prices = np.asarray(req.get('prices', []), dtype=np.float32)
    horizon = int(max(1, min(64, req.get('horizon', 8))))
    if len(prices) < 32 or not np.isfinite(prices).all() or np.any(prices <= 0):
        return {'id': req.get('id'), 'available': False, 'error': 'invalid-price-series'}

    # TimesFM forecasts the supplied series directly. We use log-price rather
    # than log-returns so the model can forecast a coherent future price path;
    # the Node side receives the resulting return plus uncertainty bands.
    log_prices = np.log(prices.astype(np.float64)).astype(np.float32)
    context = log_prices[-16384:]
    x = torch.tensor(context, dtype=torch.float32, device=MODEL.device)
    with torch.no_grad():
        out = MODEL(past_values=[x], return_dict=True)

    mean = out.mean_predictions[0].detach().float().cpu().numpy()[:horizon]
    full = out.full_predictions[0].detach().float().cpu().numpy()[:horizon]
    if mean.size == 0 or full.size == 0 or not np.isfinite(mean).all() or not np.isfinite(full).all():
        return {'id': req.get('id'), 'available': False, 'error': 'non-finite-forecast'}

    last_price = float(prices[-1])
    mean_price = float(np.exp(mean[-1]))
    # TimesFM 2.5 full_predictions layout: mean, q10, q20, ..., q90.
    p10_price = float(np.exp(full[-1, 1]))
    p50_price = float(np.exp(full[-1, 5]))
    p90_price = float(np.exp(full[-1, 9]))

    def pct(v):
        return (v / last_price - 1.0) * 100.0

    return {
        'id': req.get('id'),
        'available': True,
        'expectedReturnPct': pct(mean_price),
        'p10ReturnPct': pct(p10_price),
        'p50ReturnPct': pct(p50_price),
        'p90ReturnPct': pct(p90_price),
        'lastPrice': last_price,
        'forecastPrice': mean_price,
        'p10Price': p10_price,
        'p50Price': p50_price,
        'p90Price': p90_price,
        'horizon': horizon,
        'model': MODEL_NAME
    }

for line in sys.stdin:
    try:
        req = json.loads(line)
        print(json.dumps(forecast(req), separators=(',', ':')), flush=True)
    except Exception as exc:
        print(json.dumps({'id': None, 'available': False, 'error': f'{type(exc).__name__}: {exc}'}), flush=True)
