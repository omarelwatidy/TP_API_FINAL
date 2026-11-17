import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  poll: { type: ObjectId, ref: 'Poll', required: true },
  user: { type: ObjectId, ref: 'User', required: true },
  answers: [{
    _id: false,
    question: { type: ObjectId, required: true },
    option: { type: ObjectId, required: true }
  }]
}, { collection: 'pollanswers', timestamps: true, versionKey: false });

Schema.index({ poll: 1, user: 1 }, { unique: true });

export default withJson(Schema);
