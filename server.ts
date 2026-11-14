import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  executeAgenticPipeline,
  MODEL_CRITIC_AGENT,
  MODEL_DECISION_AGENT,
  MODEL_ORCHESTRATOR,
  type BaselineReferenceContext,
} from './server/agents.ts';
import {
  CROP_DATABASE,
  DEFAULT_WEATHER_THRESHOLDS,
} from './src/engine/presets.ts';
import { simulateCrops, validateFarmProfile } from './src/engine/simulator.ts';
import {
  fetchOpenMeteoWeather,
  geocodeLocationOpenMeteo,
} from './src/engine/weather.ts';
import type {
  AppLanguage,
  ClimateScenarioId,
  FarmProfile,
  ScenarioParametersOverride,
  WeatherThresholds,
} from './src/types/domain.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health & Model Configuration Check (Never exposes GEMINI_API_KEY value!)
  app.get('/api/config-status', (_req, res) => {
    const key = process.env.GEMINI_API_KEY;
    const hasConfiguredKey = Boolean(
      key && key.trim().length > 0 && key !== 'MY_GEMINI_API_KEY'
    );
    res.json({
      appName: 'AgroVera',
      geminiKeyConfigured: hasConfiguredKey,
      models: {
        orchestrator: MODEL_ORCHESTRATOR,
        decisionAgent: MODEL_DECISION_AGENT,
        criticAgent: MODEL_CRITIC_AGENT,
      },
      weatherSource: 'Deutscher Wetterdienst (DWD ICON) via Open-Meteo API',
    });
  });

  // Crop Knowledge Base & Data Provenance Registry endpoint
  app.get('/api/crops', (_req, res) => {
    res.json(CROP_DATABASE);
  });

  // Open-Meteo Geocoding Search (prioritizing Germany)
  app.get('/api/geocode', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const lang: AppLanguage = req.query.lang === 'de' ? 'de' : 'en';
    if (q.trim().length < 2) {
      res.json({ results: [] });
      return;
    }
    try {
      const results = await geocodeLocationOpenMeteo(q, lang);
      res.json({ results });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Geocoding lookup failed.';
      res.status(502).json({ error: message, results: [] });
    }
  });

  // Standalone Weather Forecast Analysis endpoint
  app.post('/api/weather', async (req, res) => {
    const { latitude, longitude, locationLabel, thresholds } = req.body as {
      latitude: number;
      longitude: number;
      locationLabel?: string;
      thresholds?: WeatherThresholds;
    };

    const weather = await fetchOpenMeteoWeather({
      latitude: Number(latitude),
      longitude: Number(longitude),
      locationLabel: locationLabel || 'Selected Coordinates',
      thresholds: thresholds ?? DEFAULT_WEATHER_THRESHOLDS,
    });
    res.json(weather);
  });

  // Fast Deterministic Simulation endpoint (without AI invocation)
  app.post('/api/simulate', async (req, res) => {
    const {
      farm,
      scenarioId = 'baseline',
      scenarioOverride,
      weather = null,
    } = req.body as {
      farm?: FarmProfile;
      scenarioId?: ClimateScenarioId;
      scenarioOverride?: ScenarioParametersOverride;
      weather?: Awaited<ReturnType<typeof fetchOpenMeteoWeather>> | null;
    };

    if (!farm) {
      res.status(400).json({ error: 'Missing farm profile payload.' });
      return;
    }

    const validation = validateFarmProfile(farm);
    if (!validation.valid) {
      res.status(400).json({
        error: 'Farm profile failed input validation.',
        validation,
      });
      return;
    }

    const simulation = simulateCrops(
      farm,
      weather,
      scenarioId,
      scenarioOverride
    );
    res.json(simulation);
  });

  // Full End-to-End Bilingual Agentic Evaluation Pipeline
  app.post('/api/evaluate', async (req, res) => {
    const {
      farm,
      scenarioId = 'baseline',
      scenarioOverride,
      weatherThresholds,
      language = 'en',
      baselineComparison,
    } = req.body as {
      farm?: FarmProfile;
      scenarioId?: ClimateScenarioId;
      scenarioOverride?: ScenarioParametersOverride;
      weatherThresholds?: WeatherThresholds;
      language?: AppLanguage;
      baselineComparison?: BaselineReferenceContext;
    };

    const normalizedLang: AppLanguage = language === 'de' ? 'de' : 'en';

    if (!farm) {
      res.status(400).json({ error: 'Farm profile is required.' });
      return;
    }

    const validation = validateFarmProfile(farm);
    if (!validation.valid) {
      res.status(400).json({
        error: validation.issues
          .map((i) =>
            normalizedLang === 'de' ? i.messageBilingual.de : i.message
          )
          .join(' '),
        validation,
      });
      return;
    }

    try {
      const result = await executeAgenticPipeline({
        farm,
        scenarioId,
        scenarioOverride,
        weatherThresholds: weatherThresholds ?? DEFAULT_WEATHER_THRESHOLDS,
        language: normalizedLang,
        baselineComparison,
      });
      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unexpected error during agentic evaluation.';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AgroVera server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
