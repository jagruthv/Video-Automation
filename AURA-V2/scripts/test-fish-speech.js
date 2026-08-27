const fs = require('fs');
const path = require('path');
const { Client, handle_file } = require('@gradio/client');

async function runTest() {
    const BASE_URL = 'https://major-tires-bow.loca.lt'; 
    const referenceAudioPath = 'D:/Automation/AURA-V2/ethan (mp3cut.net).mp3'; // USE A 3-5 SEC CROP!
    const outputFile = 'D:/Automation/AURA-V2/cpu_test.wav';

    const referenceTranscript = "I was the only one guy left in my village."; // MATCH THE CROP!
    const promptText = "We walked through the empty streets... for hours. Well... at least we won't have to wait in line for food anymore.";

    try {
        const client = await Client.connect(BASE_URL, {
            headers: { 'Bypass-Tunnel-Reminder': 'true' }
        });
        
        const result = await client.predict("/basic_tts", [
            handle_file(referenceAudioPath), 
            referenceTranscript,             
            promptText,                      
            false,                           
            true,                            
            null,                            
            0.0,                             
            16,                              // REDUCED: 16 steps is easier for a CPU to handle
            0.95                             
        ]);

        const response = await fetch(result.data[0].url);
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(outputFile, Buffer.from(arrayBuffer));
        console.log("🎉 Generated on CPU - check for loops!");
    } catch (e) { console.error(e); }
}
runTest();