import mongoose from 'mongoose';
import { withJson } from './common.mjs';

const Schema = new mongoose.Schema({
  firstname: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  lastname: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Email invalide']
  },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  avatar: { type: String, trim: true, maxlength: 500 },
  age: { type: Number, min: 0, max: 120 },
  city: { type: String, trim: true, maxlength: 100 }
}, { collection: 'users', timestamps: true, versionKey: false });

export default withJson(Schema);
