import AppError from '../middleware/AppError.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  sameId, pick, getPagination, pageResult, getEvent, isOrganizer, isParticipant
} from '../middleware/checks.mjs';

const Albums = class Albums {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  async getAlbum(id, user) {
    const album = await this.models.Album.findById(id);
    if (!album) throw new AppError(404, 'Album introuvable');

    // getEvent vérifie aussi que l'utilisateur a le droit de voir l'événement
    const event = await getEvent(this.models, album.event, user);
    return { album, event };
  }

  async getPhoto(id, user) {
    const photo = await this.models.Photo.findById(id);
    if (!photo) throw new AppError(404, 'Photo introuvable');

    const { event } = await this.getAlbum(photo.album, user);
    return { photo, event };
  }

  // ---------------------------------------------------------------- Albums
  createAlbum() {
    this.app.post('/albums', authenticate, async (req, res) => {
      const event = await getEvent(this.models, req.body.event, req.user);
      if (!isParticipant(event, req.user)) {
        throw new AppError(403, 'Réservé aux participants de l\'événement');
      }

      const album = await this.models.Album.create({
        event: event.id,
        title: req.body.title,
        description: req.body.description,
        createdBy: req.user.id
      });

      res.status(201).json(album);
    });
  }

  listAlbums() {
    this.app.get('/albums', authenticate, async (req, res) => {
      if (!req.query.event) throw new AppError(422, 'Le paramètre event est obligatoire');

      const event = await getEvent(this.models, String(req.query.event), req.user);

      const p = getPagination(req.query);
      const filter = { event: event.id };
      const albums = await this.models.Album.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.Album.countDocuments(filter);

      res.status(200).json(pageResult(albums, total, p));
    });
  }

  showAlbum() {
    this.app.get('/albums/:id', authenticate, async (req, res) => {
      const { album } = await this.getAlbum(req.params.id, req.user);
      res.status(200).json(album);
    });
  }

  updateAlbum() {
    this.app.put('/albums/:id', authenticate, async (req, res) => {
      const { album, event } = await this.getAlbum(req.params.id, req.user);

      // Le créateur de l'album ou un organisateur
      if (!sameId(album.createdBy, req.user.id) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      album.set(pick(req.body, ['title', 'description']));
      await album.save();

      res.status(200).json(album);
    });
  }

  removeAlbum() {
    this.app.delete('/albums/:id', authenticate, async (req, res) => {
      const { album, event } = await this.getAlbum(req.params.id, req.user);

      if (!sameId(album.createdBy, req.user.id) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      // On supprime aussi les photos de l'album
      await this.models.Photo.deleteMany({ album: album.id });
      await album.deleteOne();

      res.status(204).end();
    });
  }

  // ---------------------------------------------------------------- Photos
  createPhoto() {
    this.app.post('/albums/:id/photos', authenticate, async (req, res) => {
      const { album, event } = await this.getAlbum(req.params.id, req.user);
      if (!isParticipant(event, req.user)) {
        throw new AppError(403, 'Seuls les participants peuvent poster des photos');
      }

      const photo = await this.models.Photo.create({
        album: album.id,
        author: req.user.id,
        url: req.body.url,
        caption: req.body.caption
      });

      res.status(201).json(photo);
    });
  }

  listPhotos() {
    this.app.get('/albums/:id/photos', authenticate, async (req, res) => {
      const { album } = await this.getAlbum(req.params.id, req.user);

      const p = getPagination(req.query);
      const filter = { album: album.id };
      const photos = await this.models.Photo.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit);
      const total = await this.models.Photo.countDocuments(filter);

      res.status(200).json(pageResult(photos, total, p));
    });
  }

  showPhoto() {
    this.app.get('/photos/:id', authenticate, async (req, res) => {
      const { photo } = await this.getPhoto(req.params.id, req.user);
      res.status(200).json(photo);
    });
  }

  updatePhoto() {
    this.app.put('/photos/:id', authenticate, async (req, res) => {
      const { photo } = await this.getPhoto(req.params.id, req.user);

      if (!sameId(photo.author, req.user.id)) {
        throw new AppError(403, 'Seul l\'auteur peut modifier la photo');
      }

      photo.caption = req.body.caption;
      await photo.save();

      res.status(200).json(photo);
    });
  }

  removePhoto() {
    this.app.delete('/photos/:id', authenticate, async (req, res) => {
      const { photo, event } = await this.getPhoto(req.params.id, req.user);

      if (!sameId(photo.author, req.user.id) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      await photo.deleteOne();
      res.status(204).end();
    });
  }

  // ---------------------------------------------------- Commentaires des photos
  listComments() {
    this.app.get('/photos/:id/comments', authenticate, async (req, res) => {
      const { photo } = await this.getPhoto(req.params.id, req.user);
      res.status(200).json(photo.comments);
    });
  }

  createComment() {
    this.app.post('/photos/:id/comments', authenticate, async (req, res) => {
      const { photo, event } = await this.getPhoto(req.params.id, req.user);
      if (!isParticipant(event, req.user)) {
        throw new AppError(403, 'Seuls les participants peuvent commenter');
      }

      photo.comments.push({ author: req.user.id, content: req.body.content });
      await photo.save();

      res.status(201).json(photo.comments[photo.comments.length - 1]);
    });
  }

  updateComment() {
    this.app.put('/photos/:id/comments/:commentId', authenticate, async (req, res) => {
      const { photo } = await this.getPhoto(req.params.id, req.user);

      const comment = photo.comments.id(req.params.commentId);
      if (!comment) throw new AppError(404, 'Commentaire introuvable');
      if (!sameId(comment.author, req.user.id)) {
        throw new AppError(403, 'Vous ne pouvez modifier que vos commentaires');
      }

      comment.content = req.body.content;
      await photo.save();

      res.status(200).json(comment);
    });
  }

  removeComment() {
    this.app.delete('/photos/:id/comments/:commentId', authenticate, async (req, res) => {
      const { photo, event } = await this.getPhoto(req.params.id, req.user);

      const comment = photo.comments.id(req.params.commentId);
      if (!comment) throw new AppError(404, 'Commentaire introuvable');
      if (!sameId(comment.author, req.user.id) && !isOrganizer(event, req.user)) {
        throw new AppError(403, 'Accès interdit');
      }

      photo.comments.pull(req.params.commentId);
      await photo.save();

      res.status(204).end();
    });
  }

  run() {
    this.createAlbum();
    this.listAlbums();
    this.showAlbum();
    this.updateAlbum();
    this.removeAlbum();
    this.createPhoto();
    this.listPhotos();
    this.showPhoto();
    this.updatePhoto();
    this.removePhoto();
    this.listComments();
    this.createComment();
    this.updateComment();
    this.removeComment();
  }
};

export default Albums;
