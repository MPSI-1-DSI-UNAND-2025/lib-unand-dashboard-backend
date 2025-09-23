import { DataTypes, fn, col, Op } from 'sequelize';

// Force use of Sequelize only (no raw SQL fallback as per request)
const USE_SEQUELIZE = true;
let biblioModelRef: any = null;
let itemModelRef: any = null;
let loanModelRef: any = null;
let memberModelRef: any = null;
let associationsSet = false;

async function getModels() {
  if (!USE_SEQUELIZE) return { Biblio: null, Item: null, Loan: null, Member: null };
  if (!biblioModelRef || !itemModelRef || !loanModelRef || !memberModelRef) {
    await import('../db/sequelize.js');
    const { sequelize } = await import('../db/sequelize.js');
    biblioModelRef = biblioModelRef || sequelize.define('biblio', {
      biblio_id: { type: DataTypes.INTEGER, primaryKey: true },
      title: { type: DataTypes.STRING }
    }, { tableName: 'biblio', timestamps: false });
    itemModelRef = itemModelRef || sequelize.define('item', {
      item_id: { type: DataTypes.INTEGER, primaryKey: true },
      biblio_id: { type: DataTypes.INTEGER },
      item_code: { type: DataTypes.STRING }
    }, { tableName: 'item', timestamps: false });
    loanModelRef = loanModelRef || sequelize.define('loan', {
      loan_id: { type: DataTypes.INTEGER, primaryKey: true },
      item_code: { type: DataTypes.STRING },
      loan_date: { type: DataTypes.DATE },
      is_lent: { type: DataTypes.TINYINT },
      is_return: { type: DataTypes.TINYINT },
      member_id: { type: DataTypes.INTEGER }
    }, { tableName: 'loan', timestamps: false });
    memberModelRef = memberModelRef || sequelize.define('member', {
      member_id: { type: DataTypes.INTEGER, primaryKey: true },
      member_name: { type: DataTypes.STRING }
    }, { tableName: 'member', timestamps: false });
  }
  if (!associationsSet && biblioModelRef && itemModelRef && loanModelRef && memberModelRef) {
    itemModelRef.belongsTo(biblioModelRef, { foreignKey: 'biblio_id' });
    loanModelRef.belongsTo(itemModelRef, { foreignKey: 'item_code', targetKey: 'item_code' });
    loanModelRef.belongsTo(memberModelRef, { foreignKey: 'member_id' });
    associationsSet = true;
  }
  return { Biblio: biblioModelRef, Item: itemModelRef, Loan: loanModelRef, Member: memberModelRef };
}

export interface BookCollectionStats {
  total_unique_titles: number; // jumlah judul unik (biblio)
  total_items: number;         // jumlah koleksi (item)
}

/**
 * Get total unique titles (rows in biblio) and total items (rows in item).
 * Two independent counts; no join required.
 */
export async function getBookCollectionStats(): Promise<BookCollectionStats> {
  const { Biblio, Item } = await getModels();
  if (!Biblio || !Item) throw new Error('Sequelize not initialized for collection stats');
  const [titles, items] = await Promise.all([
    Biblio.count(),
    Item.count()
  ]);
  return { total_unique_titles: titles, total_items: items };
}

export interface TopBorrowedBook {
  biblio_id: number;
  title: string;
  total_loans: number;
}

export interface TopBorrower {
  member_id: number;
  member_name: string;
  total_loans: number;
}

// Returns top N most borrowed books (all time) aggregating loan->item->biblio
export async function getTopBorrowedBooks(limit = 10): Promise<TopBorrowedBook[]> {
  const { Loan, Item, Biblio } = await getModels();
  if (!Loan || !Item || !Biblio) throw new Error('Sequelize not initialized for top borrowed books');
  const rows = await Loan.findAll({
    attributes: [
      [col('item.biblio_id'), 'biblio_id'],
      [col('item->biblio.title'), 'title'],
      [fn('COUNT', col('loan_id')), 'total_loans']
    ],
    where: { is_lent: 1 },
    include: [{
      model: Item,
      attributes: [],
      include: [{ model: Biblio, attributes: [] }]
    }],
    group: ['item.biblio_id', 'item->biblio.biblio_id', 'item->biblio.title'],
    order: [[fn('COUNT', col('loan_id')), 'DESC']],
    limit,
    raw: true
  });
  return (rows as any[]).map(r => ({
    biblio_id: Number(r.biblio_id),
    title: r.title,
    total_loans: Number(r.total_loans)
  }));
}

// Top borrowed for current month (loan_date in current calendar month)
export async function getTopBorrowedBooksThisMonth(limit = 10): Promise<TopBorrowedBook[]> {
  const { Loan, Item, Biblio } = await getModels();
  if (!Loan || !Item || !Biblio) throw new Error('Sequelize not initialized for top borrowed month');
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const rows = await Loan.findAll({
    attributes: [
      [col('item.biblio_id'), 'biblio_id'],
      [col('item->biblio.title'), 'title'],
      [fn('COUNT', col('loan_id')), 'total_loans']
    ],
    where: {
      is_lent: 1,
      loan_date: { [Op.gte]: startMonth, [Op.lt]: nextMonth }
    },
    include: [{
      model: Item,
      attributes: [],
      include: [{ model: Biblio, attributes: [] }]
    }],
    group: ['item.biblio_id', 'item->biblio.biblio_id', 'item->biblio.title'],
    order: [[fn('COUNT', col('loan_id')), 'DESC']],
    limit,
    raw: true
  });
  return (rows as any[]).map(r => ({
    biblio_id: Number(r.biblio_id),
    title: r.title,
    total_loans: Number(r.total_loans)
  }));
}

// Top borrowed for current year
export async function getTopBorrowedBooksThisYear(limit = 10): Promise<TopBorrowedBook[]> {
  const { Loan, Item, Biblio } = await getModels();
  if (!Loan || !Item || !Biblio) throw new Error('Sequelize not initialized for top borrowed year');
  const now = new Date();
  const startYear = new Date(now.getFullYear(), 0, 1);
  const nextYear = new Date(now.getFullYear() + 1, 0, 1);
  const rows = await Loan.findAll({
    attributes: [
      [col('item.biblio_id'), 'biblio_id'],
      [col('item->biblio.title'), 'title'],
      [fn('COUNT', col('loan_id')), 'total_loans']
    ],
    where: {
      is_lent: 1,
      loan_date: { [Op.gte]: startYear, [Op.lt]: nextYear }
    },
    include: [{
      model: Item,
      attributes: [],
      include: [{ model: Biblio, attributes: [] }]
    }],
    group: ['item.biblio_id', 'item->biblio.biblio_id', 'item->biblio.title'],
    order: [[fn('COUNT', col('loan_id')), 'DESC']],
    limit,
    raw: true
  });
  return (rows as any[]).map(r => ({
    biblio_id: Number(r.biblio_id),
    title: r.title,
    total_loans: Number(r.total_loans)
  }));
}

// Top borrowers current month
export async function getTopBorrowersThisMonth(limit = 10): Promise<TopBorrower[]> {
  const { Loan, Member } = await getModels();
  if (!Loan || !Member) throw new Error('Sequelize not initialized for top borrowers month');
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const rows = await Loan.findAll({
    attributes: [
      [col('member.member_id'), 'member_id'],
      [col('member.member_name'), 'member_name'],
      [fn('COUNT', col('loan_id')), 'total_loans']
    ],
    where: {
      is_lent: 1,
      loan_date: { [Op.gte]: startMonth, [Op.lt]: nextMonth }
    },
    include: [{ model: Member, attributes: [] }],
    group: ['member.member_id', 'member.member_name'],
    order: [[fn('COUNT', col('loan_id')), 'DESC']],
    limit,
    raw: true
  });
  return (rows as any[]).map(r => ({
    member_id: Number(r.member_id),
    member_name: r.member_name,
    total_loans: Number(r.total_loans)
  }));
}

// Top borrowers current year
export async function getTopBorrowersThisYear(limit = 10): Promise<TopBorrower[]> {
  const { Loan, Member } = await getModels();
  if (!Loan || !Member) throw new Error('Sequelize not initialized for top borrowers year');
  const now = new Date();
  const startYear = new Date(now.getFullYear(), 0, 1);
  const nextYear = new Date(now.getFullYear() + 1, 0, 1);
  const rows = await Loan.findAll({
    attributes: [
      [col('member.member_id'), 'member_id'],
      [col('member.member_name'), 'member_name'],
      [fn('COUNT', col('loan_id')), 'total_loans']
    ],
    where: {
      is_lent: 1,
      loan_date: { [Op.gte]: startYear, [Op.lt]: nextYear }
    },
    include: [{ model: Member, attributes: [] }],
    group: ['member.member_id', 'member.member_name'],
    order: [[fn('COUNT', col('loan_id')), 'DESC']],
    limit,
    raw: true
  });
  return (rows as any[]).map(r => ({
    member_id: Number(r.member_id),
    member_name: r.member_name,
    total_loans: Number(r.total_loans)
  }));
}
