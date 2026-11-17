export const notFound = (req, res) => {
  res.status(404).json({ code: 404, message: 'Not Found' });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err.expose && err.status) {
    return res.status(err.status).json({
      code: err.status,
      message: err.message,
      ...(err.details && { errors: err.details })
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 400, message: 'JSON invalide' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ code: 413, message: 'Requête trop volumineuse' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ code: 400, message: 'Identifiant invalide' });
  }
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      code: 422,
      message: 'Données invalides',
      errors: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }))
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({ code: 409, message: 'Ressource déjà existante' });
  }
  if (err.message === 'Origin non autorisée par CORS') {
    return res.status(403).json({ code: 403, message: err.message });
  }

  // Détail uniquement dans les logs serveur, jamais côté client
  console.error(`[ERROR] ${req.method} ${req.originalUrl} ->`, err);
  return res.status(500).json({ code: 500, message: 'Internal Server error' });
};
