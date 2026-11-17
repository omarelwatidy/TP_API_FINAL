import mongoose from 'mongoose';
import { CommentSchema } from './message.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  album: { type: ObjectId, ref: 'Album', required: true, index: true },
  author: { type: ObjectId, ref: 'User', required: true }, // le participant qui a posté la photo
  url: { type: String, required: true, trim: true, maxlength: 500, match: [/^https?:\/\/\S+$/, 'URL invalide'] },
  caption: { type: String, trim: true, maxlength: 500, default: '' },
  comments: [CommentSchema]
}, {
  collection: 'photos',
  timestamps: true,
  versionKey: false
}).set('toJSON', {
  transform: (doc, ret) => {
    const result = ret;
    result.id = result._id;
    delete result._id;
    return result;
  }
});

export default Schema;
