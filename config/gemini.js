const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Siapkan koneksi
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Konfigurasi model (pilih gemini-2.5-flash agar cepat & gratis)
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

module.exports = model;