import { RoomFacility } from '../models/RoomFacility.js';

export interface CreateRoomFacilityInput {
  name: string;
  description?: string | null;
  photo_path?: string | null;
}

export class RoomFacilityService {
  static async create(data: CreateRoomFacilityInput) {
    const record = await RoomFacility.create({
      name: data.name,
      description: data.description || null,
      photo_path: data.photo_path || null
    });
    return record.toJSON();
  }

  static async list() {
    const rows = await RoomFacility.findAll({ order: [['id', 'DESC']] });
    return rows.map(r => r.toJSON());
  }

  static async get(id: number) {
    const row = await RoomFacility.findByPk(id);
    return row ? row.toJSON() : null;
  }

  static async update(id: number, patch: Partial<CreateRoomFacilityInput>) {
    const row = await RoomFacility.findByPk(id);
    if (!row) return null;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description || null;
    if (patch.photo_path !== undefined) row.photo_path = patch.photo_path || null;
    row.updated_at = new Date();
    await row.save();
    return row.toJSON();
  }

  static async remove(id: number) {
    const row = await RoomFacility.findByPk(id);
    if (!row) return false;
    await row.destroy();
    return true;
  }
}

export default RoomFacilityService;
