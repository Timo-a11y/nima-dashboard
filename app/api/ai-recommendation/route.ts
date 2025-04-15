import { NextResponse } from 'next/server';

export async function GET() {
  const prompt = `Geef mij een trending onderwerp, artikel of video voor iemand die geïnteresseerd is in technologie, lifestyle en muziek. Formuleer het in maximaal 3 zinnen.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });

  const json = await response.json();
  const result = json.choices?.[0]?.message?.content;

  return NextResponse.json({ result });
}
