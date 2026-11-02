/** Sample instructions for trying the app. The organisations are fictional. */
export interface SampleInstructions {
  id: string;
  name: string;
  description: string;
  text: string;
}

export const SAMPLES: SampleInstructions[] = [
  {
    id: "university",
    name: "University application",
    description: "Photo, signature, CV, statement, transcripts and passport copy",
    text: `Northbridge University — Graduate application uploads

Please upload the following documents. Files that do not meet these requirements will be rejected.

1. Passport-style photo: JPG only, square, between 600 x 600 and 1200 x 1200 pixels, maximum 240 KB. Plain white background.
2. Scanned signature: JPG or PNG, 10–50 KB, black and white.
3. CV / résumé: PDF, maximum 2 pages, under 2 MB.
4. Statement of purpose: PDF, max 1 MB.
5. Academic transcripts: combine all transcripts into a single PDF, no larger than 5 MB.
6. Copy of passport (identity page): PDF or JPG, max 3 MB, in colour.

Name each file LASTNAME_Firstname_Document (no spaces or special characters). The total upload must not exceed 15 MB.`,
  },
  {
    id: "rental",
    name: "Rental dossier (French)",
    description: "ID, proof of address, payslips, tax notice, employment proof",
    text: `Dossier de location — Résidence Les Tilleuls

Merci de déposer les pièces suivantes, au format PDF uniquement, 5 Mo maximum par fichier :
- Pièce d'identité (recto-verso dans un seul fichier)
- Justificatif de domicile de moins de 3 mois
- 3 derniers bulletins de salaire (regroupés en un seul PDF)
- Dernier avis d'imposition
- Contrat de travail ou attestation employeur

Les fichiers ne doivent pas comporter d'espaces. Taille totale maximale : 20 Mo.`,
  },
  {
    id: "job",
    name: "Job application",
    description: "CV, cover letter, optional portfolio and profile picture",
    text: `Software Engineer — Halden Systems careers portal

Attach your CV and cover letter. Accepted formats: PDF, DOCX. Maximum file size 5 MB each.
Optional: portfolio or writing sample (PDF, up to 10 MB).
Profile picture (optional): PNG or JPG, at least 400 x 400 px, square.`,
  },
  {
    id: "visa",
    name: "Visa application",
    description: "Digital photo, passport page and bank statements",
    text: `Online visa application — document upload rules

Digital photograph
- Format: JPEG
- Dimensions: 600 x 600 pixels (square)
- File size: between 54 KB and 240 KB
- Colour photo, plain light background

Passport bio page
- Colour scan, PDF or JPEG, 300 dpi, max 1 MB

Proof of funds (bank statements for the last 3 months)
- Single PDF, up to 4 MB, maximum 10 pages`,
  },
];
