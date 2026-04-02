const fs = require('fs');

async function testCartesia() {
  const url = 'https://api.cartesia.ai/tts/bytes';
  const apiKey = 'sk_car_6e31tHinEZDqRQv5Fd7YkY';
  
  const body = {
    model_id: "sonic-english",
    transcript: "This new AI is crazy. It can code for you. And it is completely free.",
    voice: {
      mode: "id",
      id: "e07c00bc-4134-4eae-9ea4-1a55fb45746b"
    },
    output_format: {
      container: "mp3",
      encoding: "pcm_f32le",
      sample_rate: 44100
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2024-06-10',
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Failed:', res.status, text);
      return;
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    fs.writeFileSync('./test-cartesia-output.mp3', buffer);
    console.log('✅ Cartesia API SUCCESS! Wrote test-cartesia-output.mp3, size:', buffer.length, 'bytes');
  } catch (err) {
    console.error('Error:', err);
  }
}

testCartesia();
