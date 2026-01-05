require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

console.log("Sedang mengecek model ke Google...");

fetch(url)
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            console.error("ERROR DARI GOOGLE:", JSON.stringify(data.error, null, 2));
        } else {
            console.log("=== DAFTAR MODEL YANG TERSEDIA UNTUK ANDA ===");
            // Filter hanya model yang bisa 'generateContent'
            const availableModels = data.models.filter(m => m.supportedGenerationMethods.includes("generateContent"));

            availableModels.forEach(model => {
                console.log(`- Nama: ${model.name.replace('models/', '')}`); // Kita hapus prefix 'models/' agar bersih
                console.log(`  Deskripsi: ${model.description.substring(0, 50)}...`);
            });
            console.log("===============================================");
            console.log("Gunakan salah satu 'Nama' di atas ke dalam file config/gemini.js Anda.");
        }
    })
    .catch(err => console.error("Gagal koneksi:", err));