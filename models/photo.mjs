import mongoose from 'mongoose';
import { withJson } from './common.mjs';
import { CommentSchema } from './message.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  album: { type: ObjectId, ref: 'Album', required: true, index: true },
  author: { type: ObjectId, ref: 'User', required: true },
  url: { type: String, required: true, trim: true, maxlength: 500 },
  caption: { type: String, trim: true, maxlength: 500, default: '' },
  comments: [CommentSchema]
}, { collection: 'photos', timestamps: true, versionKey: false });

export default withJson(Schema);
