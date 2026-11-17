import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  event: { type: ObjectId, ref: 'Event', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  sold: { type: Number, default: 0, min: 0 }
}, { collection: 'tickettypes', timestamps: true, versionKey: false });

Schema.virtual('remaining').get(function remaining() {
  return this.quantity - this.sold;
});

export default withJson(Schema);
