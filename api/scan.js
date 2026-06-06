import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PROMPTS = {
  prestation: `Tu es un juriste expert en droit des affaires français spécialisé dans les contrats de prestation de services. 
Analyse ce contrat et identifie :
1. Les clauses critiques manquantes ou déséquilibrées (responsabilité, propriété intellectuelle, résiliation, pénalités)
2. Les clauses conformes et bien rédigées
3. Les avertissements (clauses présentes mais insuffisantes)

Pour chaque point, indique le niveau de risque (critique/avertissement/conforme) et une suggestion de correction précise avec les articles de loi applicables.`,

  nda: `Tu es un juriste expert en droit français spécialisé dans les accords de confidentialité (NDA).
Analyse ce contrat et vérifie :
1. La définition des informations confidentielles (trop vague, trop large, absente)
2. La durée de confidentialité (raisonnable, excessive, absente)
3. Les exceptions standard (info publique, info connue avant, obligation légale)
4. Les sanctions en cas de violation
5. Le périmètre géographique et les tiers autorisés

Pour chaque point, indique le niveau de risque (critique/avertissement/conforme) avec les articles applicables (loi secret des affaires 2018, Directive UE 2016/943).`,

  cgv: `Tu es un juriste expert en droit de la consommation et droit commercial français.
Analyse ces CGV et vérifie :
1. Les mentions obligatoires (art. L441-1 C.com., art. L221-11 C.conso.)
2. Le droit de rétractation (si B2C - 14 jours, art. L221-18 C.conso.)
3. La clause attributive de juridiction
4. La limitation de garantie légale de conformité
5. Les délais de livraison et responsabilité
6. La protection des données personnelles (RGPD)

Pour chaque point, indique le niveau de risque avec les textes légaux précis.`,

  bail: `Tu es un juriste expert en baux commerciaux et droit immobilier français.
Analyse ce bail et vérifie :
1. La durée et les conditions de renouvellement (statut 3-6-9, art. L145-1 C.com.)
2. La clause d'indexation (ILC ou ILAT selon activité, Loi Pinel 2014)
3. La répartition des charges et travaux (décret 2014, Loi Pinel)
4. Le droit au renouvellement et l'indemnité d'éviction
5. La clause résolutoire (délai de mise en demeure)
6. La destination des locaux et la déspécialisation
7. Le dépôt de garantie (max 2 termes si loyer trimestriel)

Pour chaque point, indique le niveau de risque avec les articles du Code de commerce applicables.`,

  general: `Tu es un juriste expert en droit des affaires français.
Analyse ce contrat et identifie :
1. Les clauses déséquilibrées ou abusives
2. Les mentions légales obligatoires manquantes
3. Les risques juridiques pour chaque partie
4. Les clauses bien rédigées et conformes

Pour chaque point, indique le niveau de risque (critique/avertissement/conforme) et une suggestion de correction avec les textes légaux applicables.`
};

const SYSTEM_PROMPT = `Tu es un juriste expert en droit des affaires français avec 15 ans d'expérience en audit contractuel. 
Tu analyses des contrats pour identifier les risques juridiques et les clauses déséquilibrées.

Tu dois TOUJOURS répondre en JSON valide avec cette structure exacte :
{
  "score": <nombre entre 0 et 100>,
  "verdict": "<une phrase résumant le niveau de risque global>",
  "contractType": "<type de contrat détecté>",
  "critical": <nombre de points critiques>,
  "warnings": <nombre d'avertissements>,
  "ok": <nombre de points conformes>,
  "findings": [
    {
      "level": "critical|warning|ok|info",
      "title": "<titre court de la clause>",
      "description": "<description du problème ou de la conformité>",
      "suggestion": "<suggestion de correction avec article de loi si applicable>"
    }
  ],
  "summary": "<résumé exécutif de 2-3 phrases>"
}

Règles importantes :
- Le score reflète la qualité globale du contrat (0=très risqué, 100=excellent)
- Sois précis sur les articles de loi (Code civil, Code de commerce, etc.)
- Les suggestions doivent être actionnables et concrètes
- Ne réponds JAMAIS avec autre chose que du JSON valide
- Minimum 5 findings, maximum 12`;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { contractText, contractType = "general" } = req.body;

    if (!contractText || contractText.trim().length < 100) {
      return res.status(400).json({
        error: "Le contrat est trop court ou vide. Minimum 100 caractères.",
      });
    }

    if (contractText.length > 50000) {
      return res.status(400).json({
        error: "Le contrat est trop long. Maximum 50 000 caractères.",
      });
    }

    const userPrompt =
      PROMPTS[contractType] ||
      PROMPTS.general +
        `\n\nVoici le contrat à analyser :\n\n${contractText}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${userPrompt}\n\nContrat à analyser :\n\n${contractText}`,
        },
      ],
    });

    const responseText = message.content[0].text;

    // Parse JSON response
    let analysis;
    try {
      // Clean potential markdown fences
      const cleaned = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      analysis = JSON.parse(cleaned);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return res.status(500).json({
        error: "Erreur lors de l'analyse. Veuillez réessayer.",
      });
    }

    return res.status(200).json({
      success: true,
      analysis,
    });
  } catch (error) {
    console.error("API error:", error);

    if (error.status === 401) {
      return res.status(500).json({ error: "Clé API invalide." });
    }

    if (error.status === 429) {
      return res
        .status(429)
        .json({ error: "Trop de requêtes. Réessayez dans quelques secondes." });
    }

    return res.status(500).json({
      error: "Une erreur est survenue. Veuillez réessayer.",
    });
  }
}
