import validate from '../middleware/validate.mjs';
import { authenticate } from '../middleware/auth.mjs';
import {
  findOr404, allow, pick, sameId, paginate, pageOf
} from '../services/helpers.mjs';
import { loadEvent, isEventOrganizer, isEventParticipant } from '../services/access.mjs';
import commentRoutes from '../services/comments.mjs';
import {
  text, url, idParam, idBody, idQuery, pagination
} from '../services/rules.mjs';

const Albums = class Albums {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.run();
  }

  async loadAlbum(id, user) {
    const album = await findOr404(this.models.Album.findById(id), 'Album');
    const event = await loadEvent(this.models, album.event, user);
    return {
      album,
      event,
      participant: isEventParticipant(event, user),
      organizer: isEventOrganizer(event, user)
    };
  }

  async loadPhoto(id, user) {
    const photo = await findOr404(this.models.Photo.findById(id), 'Photo');
    const ctx = await this.loadAlbum(photo.album, user);
    return { photo, ...ctx };
  }

  // ------------------------------------------------------------------ Albums
  createAlbum() {
    const rules = () => [idBody('event'), text('title', { min: 2, max: 100 }), text('description', { min: 0, max: 1000, optional: true })];

    this.app.post('/albums', authenticate, rules(), validate, async (req, res) => {
      const event = await loadEvent(this.models, req.body.event, req.user);
      allow(isEventParticipant(event, req.user), 'Réservé aux participants de l\'événement');

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
    this.app.get('/albums', authenticate, idQuery('event'), pagination, validate, async (req, res) => {
      await loadEvent(this.models, req.query.event, req.user);

      const p = paginate(req.query);
      const filter = { event: req.query.event };
      const [albums, total] = await Promise.all([
        this.models.Album.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
        this.models.Album.countDocuments(filter)
      ]);
      res.status(200).json(pageOf(albums, total, p));
    });
  }

  showAlbum() {
    this.app.get('/albums/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadAlbum(req.params.id, req.user);
      res.status(200).json(ctx.album);
    });
  }

  updateAlbum() {
    const rules = () => [text('title', { min: 2, max: 100, optional: true }), text('description', { min: 0, max: 1000, optional: true })];

    this.app.put('/albums/:id', authenticate, idParam(), rules(), validate, async (req, res) => {
      const ctx = await this.loadAlbum(req.params.id, req.user);
      allow(sameId(ctx.album.createdBy, req.user.id) || ctx.organizer);

      ctx.album.set(pick(req.body, ['title', 'description']));
      await ctx.album.save();
      res.status(200).json(ctx.album);
    });
  }

  removeAlbum() {
    this.app.delete('/albums/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadAlbum(req.params.id, req.user);
      allow(sameId(ctx.album.createdBy, req.user.id) || ctx.organizer);

      await this.models.Photo.deleteMany({ album: ctx.album.id });
      await ctx.album.deleteOne();
      res.status(204).end();
    });
  }

  // ------------------------------------------------------------------ Photos
  createPhoto() {
    const rules = () => [url('url', false), text('caption', { min: 0, max: 500, optional: true })];

    this.app.post('/albums/:id/photos', authenticate, idParam(), rules(), validate, async (req, res) => {
      const ctx = await this.loadAlbum(req.params.id, req.user);
      allow(ctx.participant, 'Seuls les participants peuvent poster des photos');

      const photo = await this.models.Photo.create({
        album: ctx.album.id,
        author: req.user.id,
        url: req.body.url,
        caption: req.body.caption
      });
      res.status(201).json(photo);
    });
  }

  listPhotos() {
    this.app.get('/albums/:id/photos', authenticate, idParam(), pagination, validate, async (req, res) => {
      const ctx = await this.loadAlbum(req.params.id, req.user);

      const p = paginate(req.query);
      const filter = { album: ctx.album.id };
      const [photos, total] = await Promise.all([
        this.models.Photo.find(filter).sort({ createdAt: -1 }).skip(p.skip).limit(p.limit),
        this.models.Photo.countDocuments(filter)
      ]);
      res.status(200).json(pageOf(photos, total, p));
    });
  }

  showPhoto() {
    this.app.get('/photos/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadPhoto(req.params.id, req.user);
      res.status(200).json(ctx.photo);
    });
  }

  updatePhoto() {
    this.app.put('/photos/:id', authenticate, idParam(), text('caption', { min: 0, max: 500 }), validate, async (req, res) => {
      const ctx = await this.loadPhoto(req.params.id, req.user);
      allow(sameId(ctx.photo.author, req.user.id), 'Seul l\'auteur peut modifier la photo');

      ctx.photo.caption = req.body.caption;
      await ctx.photo.save();
      res.status(200).json(ctx.photo);
    });
  }

  removePhoto() {
    this.app.delete('/photos/:id', authenticate, idParam(), validate, async (req, res) => {
      const ctx = await this.loadPhoto(req.params.id, req.user);
      allow(sameId(ctx.photo.author, req.user.id) || ctx.organizer);

      await ctx.photo.deleteOne();
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

    commentRoutes(this.app, {
      path: '/photos',
      load: async (req) => {
        const ctx = await this.loadPhoto(req.params.id, req.user);
        return {
          doc: ctx.photo,
          canRead: true,
          canComment: ctx.participant,
          canModerate: ctx.organizer
        };
      }
    });
  }
};

export default Albums;
