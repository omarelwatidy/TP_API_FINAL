import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const { ObjectId } = mongoose.Schema.Types;

const Schema = new mongoose.Schema({
  event: { type: ObjectId, ref: 'Event', required: true },
  ticketType: { type: ObjectId, ref: 'TicketType', required: true },
  firstname: { type: String, required: true, trim: true, maxlength: 50 },
  lastname: { type: String, required: true, trim: true, maxlength: 50 },
  email: { type: String, required: true, lowercase: true, trim: true },
  address: {
    street: { type: String, required: true, trim: true, maxlength: 200 },
    zipCode: { type: String, required: true, trim: true, maxlength: 20 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    country: { type: String, required: true, trim: true, maxlength: 100 }
  },
  purchasedAt: { type: Date, default: Date.now }
}, { collection: 'tickets', timestamps: true, versionKey: false });

// Une personne extérieure ne peut obtenir qu'un seul billet par événement
Schema.index({ event: 1, email: 1 }, { unique: true });

export default withJson(Schema);
