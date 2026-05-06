import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import twilio from 'twilio';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

let genAI: GoogleGenAI | null = null;
function getGenAI() {
  if (!genAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY is not defined');
    }
    genAI = new GoogleGenAI({ apiKey: key });
  }
  return genAI;
}

app.post('/api/turn', (req, res) => {
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

  if (!twilioAccountSid || !twilioAuthToken) {
    return res.json({ iceServers: [] });
  }

  try {
    const client = twilio(twilioAccountSid, twilioAuthToken);
    client.tokens.create().then(token => {
      res.json({ iceServers: token.iceServers });
    }).catch(err => {
      console.error('Twilio Error:', err);
      res.status(500).json({ error: 'Failed to create Turn token' });
    });
  } catch (err) {
    console.error('Twilio Init Error:', err);
    res.status(500).json({ error: 'Failed to initialize Twilio' });
  }
});

app.post('/api/analyze', async (req, res) => {
  try {
    const ai = getGenAI();
    const { message } = req.body;
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Analyze sentiment. Return ONLY one word: AGGRESSIVE, MELANCHOLY, NEUTRAL, VIBRANT, ANALYTIC, CALM.
      Message: "${message}"`,
    });
    res.json({ sentiment: (response.text || 'NEUTRAL').trim().toUpperCase().replace(/[^\\w]/g, '') });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/coach', async (req, res) => {
  try {
    const ai = getGenAI();
    const { text, sentiment, surveyData } = req.body;
    
    let basePrompt = `The following message has a ${sentiment} tone: "${text}". Suggest a brief (1-2 sentences), constructive alternative way to phrase this to de-escalate and improve communication flow. Act as a relationship/communication coach.`;
    
    if (surveyData && surveyData.stressor) {
       basePrompt += ` The user has reported their current primary stressor is: "${surveyData.stressor}". Keep your tone highly sensitive, supportive, and prioritize their mental well-being over winning the argument.`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: basePrompt
    });
    res.json({ text: response.text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/interpret', async (req, res) => {
  try {
    const ai = getGenAI();
    const { text, surveyData } = req.body;
    
    let basePrompt = `Analyze this message's underlying intent and summarize its logic trail. Use professional, insightful language. Message: "${text}"`;

    if (surveyData && surveyData.stressor) {
       basePrompt = `Act as a Communication Coach & Healing Advocate. Analyze this sentiment and underlying intent: "${text}". The user's known stressor is "${surveyData.stressor}". Shift to De-escalation Mode if this touches on their stressor.`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: basePrompt
    });
    res.json({ text: response.text || 'Nexus could not distill intent at this time.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Setup Vite for development or static files for production
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Production serving
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.use((req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const port = 3000;
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
  });
}

startServer();
