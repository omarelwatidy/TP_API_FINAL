// Route inconnue
export const notFound = (req, res) => {
  res.status(404).json({ code: 404, message: 'Not Found' });
};

// Gestion centrale des erreurs : le client ne voit jamais la stack ni les détails de la base
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  // Erreurs que l'on a créées nous-mêmes (AppError)
  if (err.expose && err.status) {
    const body = { code: err.status, message: err.message };
    if (err.details) {
      body.errors = err.details;
    }
    return res.status(err.status).json(body);
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 400, message: 'JSON invalide' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ code: 413, message: 'Requête trop volumineuse' });
  }

  // Mongoose : valeur impossible à convertir (id invalide, date invalide...)
  if (err.name === 'CastError') {
    return res.status(400).json({ code: 400, message: `Valeur invalide pour ${err.path}` });
  }
  // Mongoose : le schéma n'est pas respecté
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      code: 422,
      message: 'Données invalides',
      errors: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }))
    });
  }
  // Mongo : valeur déjà existante (index unique)
  if (err.code === 11000) {
    return res.status(409).json({ code: 409, message: 'Ressource déjà existante' });
  }
  if (err.message === 'Origin non autorisée par CORS') {
    return res.status(403).json({ code: 403, message: err.message });
  }

  console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err);
  return res.status(500).json({ code: 500, message: 'Internal Server error' });
};
