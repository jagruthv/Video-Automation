const fs = require('fs');
const { Client } = require('@gradio/client');

async function findEndpoint() {
    const tunnelLink = 'https://short-nails-own.loca.lt'; // Update if needed
    
    console.log("🔍 Scanning GPU for the text-to-speech endpoint...");
    const client = await Client.connect(tunnelLink, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
    });
    
    const apiInfo = await client.view_api();
    
    // Search the named endpoints
    for (const [endpointName, details] of Object.entries(apiInfo.named_endpoints)) {
        if (details.parameters) {
            for (const param of details.parameters) {
                if (param.parameter_name === 'gen_text' || param.parameter_name === 'gen_text_input' || param.label === 'Text to Generate') {
                    console.log(`\n✅ FOUND IT! The endpoint name is: "${endpointName}"`);
                    console.log(`It expects exactly ${details.parameters.length} arguments.`);
                    
                    console.log("\nArgument Order:");
                    details.parameters.forEach((p, index) => {
                        console.log(`[${index}] ${p.label} (${p.type || 'file'})`);
                    });
                    return;
                }
            }
        }
    }
    console.log("❌ Could not find the main endpoint.");
}

findEndpoint();