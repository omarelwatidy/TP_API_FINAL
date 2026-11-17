import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const { ObjectId } = mongoose.Schema.Types;

export const CommentSchema = new mongoose.Schema({
  author: { type: ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 }
}, { timestamps: true });

const Schema = new mongoose.Schema({
  thread: { type: ObjectId, ref: 'Thread', required: true, index: true },
  author: { type: ObjectId, ref: 'User', required: true },
  content: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  comments: [CommentSchema]
}, { collection: 'messages', timestamps: true, versionKey: false });

export default withJson(Schema);
