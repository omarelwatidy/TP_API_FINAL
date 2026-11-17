import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  icon: { type: String, trim: true, maxlength: 500 },
  coverPhoto: { type: String, trim: true, maxlength: 500 },
  type: { type: String, enum: ['public', 'private', 'secret'], default: 'public' },
  allowMembersToPost: { type: Boolean, default: true },
  allowMembersToCreateEvents: { type: Boolean, default: false },
  admins: [{ type: ObjectId, ref: 'User' }],
  members: [{ type: ObjectId, ref: 'User' }]
}, { collection: 'groups', timestamps: true, versionKey: false });

export default withJson(Schema);
