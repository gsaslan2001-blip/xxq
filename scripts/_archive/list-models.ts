import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const apiKey = process.env.GEMINI_API_KEY;

async function listModels() {
    try {
        const client = new GoogleGenAI({ apiKey: apiKey });
        // @ts-ignore
        const response = await client.models.list();
        console.log("Raw Response Type:", typeof response);
        console.log("Raw Response Keys:", Object.keys(response));
        if (Array.isArray(response)) {
             console.log("It is an array of length", response.length);
        } else if (response.models) {
             console.log("Found models property with length", response.models.length);
             for (const m of response.models) {
                console.log(`- ${m.name}`);
             }
        } else {
            console.log("Response:", JSON.stringify(response, null, 2));
        }
    } catch (e: any) {
        console.error("Error listing models:", e.message);
    }
}

listModels();
