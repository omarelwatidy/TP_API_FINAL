import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  event: { type: ObjectId, ref: 'Event', required: true, index: true },
  user: { type: ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
  nameKey: { type: String },
  quantity: { type: Number, required: true, min: 1 },
  arrivalTime: { type: Date, required: true }
}, { collection: 'shoppingitems', timestamps: true, versionKey: false });

Schema.pre('validate', function makeKey() {
  if (this.name) {
    this.nameKey = this.name.trim().toLowerCase();
  }
});

// Chaque chose apportée est unique par événement
Schema.index({ event: 1, nameKey: 1 }, { unique: true });

export default withJson(Schema);
