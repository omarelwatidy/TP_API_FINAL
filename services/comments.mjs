import validate from '../middleware/validate.mjs';
import { authenticate } from '../middleware/auth.mjs';
import { allow, sameId } from './helpers.mjs';
import { text, idParam } from './rules.mjs';

// Routes de commentaires partagées par les messages et les photos.
// load(req) renvoie { doc, canRead, canComment, canModerate } ; doc possède un tableau "comments".
export default (app, { path, load }) => {
  const contentRule = () => [text('content', { min: 1, max: 1000 })];

  app.get(`${path}/:id/comments`, authenticate, idParam(), validate, async (req, res) => {
    const ctx = await load(req);
    allow(ctx.canRead);
    res.status(200).json(ctx.doc.comments);
  });

  app.post(`${path}/:id/comments`, authenticate, idParam(), contentRule(), validate, async (req, res) => {
    const ctx = await load(req);
    allow(ctx.canComment, 'Seuls les membres/participants peuvent commenter');

    ctx.doc.comments.push({ author: req.user.id, content: req.body.content });
    await ctx.doc.save();

    res.status(201).json(ctx.doc.comments.at(-1));
  });

  app.put(`${path}/:id/comments/:commentId`, authenticate, idParam(), idParam('commentId'), contentRule(), validate, async (req, res) => {
    const ctx = await load(req);
    const comment = ctx.doc.comments.id(req.params.commentId);
    allow(comment, 'Commentaire introuvable');
    allow(sameId(comment.author, req.user.id), 'Vous ne pouvez modifier que vos commentaires');

    comment.content = req.body.content;
    await ctx.doc.save();

    res.status(200).json(comment);
  });

  app.delete(`${path}/:id/comments/:commentId`, authenticate, idParam(), idParam('commentId'), validate, async (req, res) => {
    const ctx = await load(req);
    const comment = ctx.doc.comments.id(req.params.commentId);
    allow(comment, 'Commentaire introuvable');
    allow(sameId(comment.author, req.user.id) || ctx.canModerate, 'Accès interdit');

    ctx.doc.comments.pull(req.params.commentId);
    await ctx.doc.save();

    res.status(204).end();
  });
};
