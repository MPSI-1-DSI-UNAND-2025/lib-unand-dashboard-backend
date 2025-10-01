import { Op } from 'sequelize';
import { Event } from '../models/Event.js';

export interface CreateEventInput {
  title: string;
  location: string;
  date: string;   // e.g. 2025-10-01
  time: string;   // e.g. 14:30
  thumbnail_path?: string | null;
}

export class EventService {
  static async create(data: CreateEventInput) {
    const startsAt = new Date(`${data.date}T${data.time}:00`);
    if (isNaN(startsAt.getTime())) throw new Error('Tanggal / jam tidak valid');

    const event = await Event.create({
      title: data.title,
      location: data.location,
      starts_at: startsAt,
      thumbnail_path: data.thumbnail_path || null
    });
    return event.toJSON();
  }

  static async list(upcomingOnly = false) {
    const where: any = {};
    if (upcomingOnly) {
      where.starts_at = { [Op.gte]: new Date() };
    }
    const events = await Event.findAll({ where, order: [['starts_at', 'ASC']] });
    return events.map(e => e.toJSON());
  }

  static async get(id: number) {
    const event = await Event.findByPk(id);
    return event ? event.toJSON() : null;
  }

  static async update(id: number, patch: Partial<CreateEventInput>) {
    const event = await Event.findByPk(id);
    if (!event) return null;

    // Update simple scalar fields
    if (patch.title !== undefined) event.title = patch.title;
    if (patch.location !== undefined) event.location = patch.location;
    if (patch.thumbnail_path !== undefined) event.thumbnail_path = patch.thumbnail_path || null;

    // Handle date/time combination logic
    if (patch.date !== undefined || patch.time !== undefined) {
      const current = event.starts_at instanceof Date ? event.starts_at : new Date(event.starts_at);
      if (isNaN(current.getTime())) throw new Error('starts_at korup');
      let dateStr = patch.date;
      let timeStr = patch.time;
      if (!dateStr) {
        // derive existing date (YYYY-MM-DD)
        dateStr = current.toISOString().slice(0,10);
      }
      if (!timeStr) {
        // derive existing time (HH:MM)
        const h = String(current.getHours()).padStart(2,'0');
        const m = String(current.getMinutes()).padStart(2,'0');
        timeStr = `${h}:${m}`;
      }
      const newStarts = new Date(`${dateStr}T${timeStr}:00`);
      if (isNaN(newStarts.getTime())) throw new Error('Tanggal / jam tidak valid');
      event.starts_at = newStarts;
    }

    await event.save();
    return event.toJSON();
  }
}

export default EventService;