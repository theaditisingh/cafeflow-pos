import 'dotenv/config';
import { createApp } from './app.js';

const port = process.env.PORT || 4000;
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set (see .env.example)');
createApp().listen(port, () => console.log(`CafeFlow API listening on http://localhost:${port}`));
