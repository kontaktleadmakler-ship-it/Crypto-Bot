# v24.6.0 Hotfix

Fixes:
- TensorFlow.js Dueling-DQN `meanLayer.setWeights is not a function`.
- Telegram `/help` tagged-template callback error.
- DQN saved-model input/output shape validation.
- Telegram `/cmd@botname` normalization.
- `/api/v24/status` endpoint.
- Stable v24.6 start command.

Live order execution remains disabled.

Recommended Render Start Command:

```text
npm start
```

Existing `node archive/legacy-bot-versions/trading-bot-v21.1-tfjs.js` commands remain compatible through a wrapper.
