import mongoose from 'mongoose';

const Schema = new mongoose.Schema({
  firstname: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  lastname: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  email: {
    type: String,
    required: true,
    unique: true, // pas deux utilisateurs avec le même email
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Email invalide']
  },
  password: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  avatar: { type: String, trim: true, maxlength: 500, match: [/^https?:\/\/\S+$/, 'URL invalide'] },
  age: { type: Number, min: 0, max: 120 },
  city: { type: String, trim: true, maxlength: 100 }
}, {
  collection: 'users',
  timestamps: true,
  versionKey: false
}).set('toJSON', {
  transform: (doc, ret) => {
    const result = ret;
    result.id = result._id;
    delete result._id;
    delete result.password;
    return result;
  }
});

export default Schema;
