import Anthropic from "@anthropic-ai/sdk";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Lire le body brut (multipart)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    const body = buffer.toString();

    // Extraire le texte du contrat et le type
    const boundary = req.headers["content-type"].split("boundary=")[1];
    const parts = body.split("--" + boundary);

    let contractText = "";
    let contractType = "contrat";

    for (const part of parts) {
      if (part.includes('name="text"')) {
        contractText = part.split("\r\n\r\n").slice(1).join("\r\n\r\n").trim();
        if (contractText.endsWith("\r\n")) contractText = contractText.slice(0, -2);
      }
      if (part.includes('name="type"')) {
        contractType = part.split("\r\n\r\n").slice(1).join("").trim();
        if (contractType.endsWith("\r\n")) contractType = contractType.slice(0, -2);
      }
    }

    if (!contractText || contractText.length < 50) {
      return res.status(400).json({ error: "Contrat trop court ou illisible." });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `Tu es un juriste expert en droit français des affaires. Analyse ce ${contractType} et produis un rapport d'audit structuré.

CONTRAT À ANALYSER :
"""
${contractText.slice(0, 12000)}
"""

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après, avec cette structure exacte :
{
  "score": <nombre entre 0 et 100>,
  "verdict": "<phrase courte décrivant le niveau de risque global>",
  "critiques": <nombre de points critiques>,
  "avertissements": <nombre d'avertissements>,
  "ok": <nombre de points conformes>,
  "findings": [
    {
      "level": "critical|warning|info|ok",
      "title": "<titre court de la clause>",
      "description": "<explication du problème ou de la conformité>",
      "suggestion": "<conseil correctif si level != ok, sinon null>"
    }
  ],
  "clauses": [
    {
      "name": "<nom de la clause>",
      "status": "<Absente|Non définie|Insuffisant|Trop vague|Conforme|Présente>",
      "priority": "critique|avertissement|ok|na"
    }
  ]
}

Règles :
- Score 0-39 = contrat risqué, 40-69 = à améliorer, 70-100 = correct
- Analyse 6 à 12 points selon la richesse du contrat
- Sois précis et cite les articles de loi français pertinents quand applicable
- Les suggestions doivent être concrètes et actionnables`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].text.trim();
    const json = JSON.parse(raw);

    return res.status(200).json(json);
  } catch (err) {
    console.error("Scan error:", err);
    return res.status(500).json({ error: "Erreur lors de l'analyse. Réessayez." });
  }
}
