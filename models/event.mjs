import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  startDate: { type: Date, required: true },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator(value) {
        return !this.startDate || value > this.startDate;
      },
      message: 'endDate doit être après startDate'
    }
  },
  location: { type: String, required: true, trim: true, maxlength: 300 },
  coverPhoto: { type: String, trim: true, maxlength: 500 },
  visibility: { type: String, enum: ['public', 'private'], default: 'public' },
  organizers: [{ type: ObjectId, ref: 'User' }],
  members: [{ type: ObjectId, ref: 'User' }],
  group: { type: ObjectId, ref: 'Group' },
  createdBy: { type: ObjectId, ref: 'User' },
  shoppingListEnabled: { type: Boolean, default: false },
  ticketingEnabled: {
    type: Boolean,
    default: false,
    validate: {
      validator(value) {
        return !value || this.visibility === 'public';
      },
      message: 'La billetterie est réservée aux événements publics'
    }
  }
}, { collection: 'events', timestamps: true, versionKey: false });

Schema.index({ startDate: 1 });

export default withJson(Schema);
