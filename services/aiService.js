// services/aiService.js

/**
 * Memanggil model AI dengan failover otomatis: LM Studio -> OpenRouter
 */
const generateWithFallback = async (prompt) => {
    // 1. Coba LM Studio Lokal
    try {
        console.log("🤖 [1/2] Menghubungi LM Studio Local Server...");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch('https://diego-beaky-unappeasably.ngrok-free.dev/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({
                model: "local-model",
                messages: [
                    { role: "system", content: "Kamu adalah asisten akademik bernama Lecturo Assistant. Jawab dengan ringkas, sopan, dan sesuai instruksi tanpa basa-basi." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.1,
                max_tokens: -1
            })
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`LM Studio HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        let aiResponseText = data.choices[0].message.content;
        aiResponseText = aiResponseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        console.log("✅ Berhasil dilayani oleh: LM Studio (Lokal)");
        return { response: { text: () => aiResponseText } };

    } catch (lmError) {
        // 2. Alihkan ke OpenRouter Cloud
        console.warn(`⚠️ LM Studio tidak merespons (${lmError.message}). Mengalihkan ke OpenRouter...`);

        try {
            const apiKey = process.env.OPENROUTER_API_KEY;
            if (!apiKey) throw new Error("OPENROUTER_API_KEY belum dipasang di file .env");

            console.log("🌐 [2/2] Menghubungi OpenRouter (Cloud Backup)...");

            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://lecturo.id',
                    'X-Title': 'Lecturo Assistant'
                },
                body: JSON.stringify({
                    model: "openrouter/free",
                    messages: [
                        { role: "system", content: "Kamu adalah asisten akademik bernama Lecturo Assistant. Jawab dengan ringkas, sopan, dan patuhi instruksi JSON atau teks yang diminta tanpa basa-basi." },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.1
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`OpenRouter HTTP ${response.status}: ${errorBody}`);
            }

            const data = await response.json();
            let aiResponseText = data.choices[0].message.content;
            aiResponseText = aiResponseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

            console.log("✅ Berhasil dilayani oleh: OpenRouter Cloud");
            return { response: { text: () => aiResponseText } };

        } catch (openRouterError) {
            console.error("❌ Kedua jalur AI gagal:", openRouterError.message);
            throw openRouterError;
        }
    }
};

module.exports = { generateWithFallback };