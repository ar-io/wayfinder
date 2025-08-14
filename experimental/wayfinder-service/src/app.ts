import { ARIO } from '@ar.io/sdk';
import { NetworkGatewaysProvider, Wayfinder } from '@ar.io/wayfinder-core';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

const app = express();
const port = process.env.PORT || 3000;
const txIdPattern = /^[a-zA-Z0-9_-]{43}$/;

app.use(helmet());
app.use(cors());
app.use(express.json());

const wayfinder = new Wayfinder({
  gatewaysProvider: new NetworkGatewaysProvider({
    ario: ARIO.mainnet(),
  }),
});

app.get('/:txId', async (req: express.Request, res: express.Response) => {
  const { txId } = req.params;

  if (!txIdPattern.test(txId)) {
    return res.status(400).json({
      error: 'Invalid transaction ID format',
      expected: '43-character alphanumeric string with dashes and underscores',
    });
  }

  try {
    const resolvedUrl = await wayfinder.resolveUrl({
      txId,
    });

    res.redirect(302, resolvedUrl.toString());
  } catch (error) {
    console.error('Error resolving txId:', error);
    res.status(500).json({ error: 'Failed to resolve transaction ID' });
  }
});

// Handle all other requests (ARNS domains)
app.use('/', async (req: express.Request, res: express.Response) => {
  const host = req.get('host');

  if (!host) {
    return res.status(400).json({ error: 'Host header required' });
  }

  try {
    const resolvedUrl = await wayfinder.resolveUrl({
      originalUrl: req.originalUrl,
    });

    if (!resolvedUrl) {
      return res.status(404).json({ error: 'URL not found' });
    }

    res.redirect(302, resolvedUrl.toString());
  } catch (error) {
    console.error('Error resolving URL:', error);
    res.status(500).json({ error: 'Failed to resolve URL' });
  }
});

app.use((err: unknown, _req: express.Request, res: express.Response) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Wayfinder service running on port ${port}`);
  console.log(`Supported patterns:`);
  console.log(`  - /{txId} - Transaction ID routing`);
  console.log(`  - <arns-name>.TLD - ARNS domain routing`);
});

export default app;
