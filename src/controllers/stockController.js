import { Category } from '../models/Category.js';
import { Brand } from '../models/Brand.js';
import { Unit } from '../models/Unit.js';
import { Warehouse } from '../models/Warehouse.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import { StockDeleteRequest } from '../models/StockDeleteRequest.js';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { Admin } from '../models/Admin.js';
import { Notification } from '../models/Notification.js';
import { notifyRoles, notifySuperAdminAndAdmins } from '../services/notificationService.js';
import { sendPushNotification } from '../config/firebase.js';
import XLSX from 'xlsx';

const getItemModel = (itemType) => {
  switch (itemType) {
    case 'Product': return Product;
    case 'Category': return Category;
    case 'Brand': return Brand;
    case 'Unit': return Unit;
    case 'Warehouse': return Warehouse;
    case 'StockMovement': return StockMovement;
    default: return null;
  }
};

const getItemSummary = (itemType, item) => {
  if (!item) return '';
  switch (itemType) {
    case 'Product':
      return `SKU: ${item.sku || 'N/A'} | Stock: ${item.currentStock || 0} | Selling Price: ₹${item.sellingPrice || 0} | Purchase Price: ₹${item.purchasePrice || 0}`;
    case 'Category':
      return `Code: ${item.code || 'N/A'} | Description: ${item.description || 'N/A'}`;
    case 'Brand':
      return `Code: ${item.code || 'N/A'} | Description: ${item.description || 'N/A'}`;
    case 'Unit':
      return `Short Name: ${item.shortName || 'N/A'}`;
    case 'Warehouse':
      return `Code: ${item.code || 'N/A'} | City: ${item.city || 'N/A'} | Manager: ${item.managerName || 'N/A'}`;
    case 'StockMovement':
      return `Type: ${item.transactionType || 'N/A'} | Qty: ${item.quantity || 0} | Ref: ${item.referenceNo || 'N/A'}`;
    default:
      return '';
  }
};

export const handleItemDeleteRequest = async ({ itemType, itemId, req, res, next, reason = '' }) => {
  try {
    const Model = getItemModel(itemType);
    if (!Model) return res.status(400).json({ status: 'fail', message: 'Invalid item type' });

    const item = await Model.findById(itemId).lean();
    if (!item) return res.status(404).json({ status: 'fail', message: `${itemType} not found` });

    const itemName = item.name || item.sku || item.referenceNo || item.code || `${itemType} #${item._id.toString().slice(-6)}`;
    const itemDetails = getItemSummary(itemType, item);
    const deleteReason = reason || req.body?.reason || req.query?.reason || 'Deletion requested from Stock panel';

    // If requester is not superAdmin: Create a pending approval request
    if (req.user.role !== 'superAdmin') {
      const existing = await StockDeleteRequest.findOne({ itemType, itemId, status: 'pending' });
      if (existing) {
        return res.status(400).json({
          status: 'fail',
          message: `A deletion request is already pending SuperAdmin approval for this ${itemType}.`
        });
      }

      const deleteReq = await StockDeleteRequest.create({
        itemType,
        itemId: item._id,
        itemName,
        itemDetails,
        itemData: item,
        reason: deleteReason,
        requestedBy: req.user._id,
        requestedByModel: req.user.role === 'admin' || req.user.role === 'superAdmin' ? 'Admin' : 'User',
        status: 'pending'
      });

      // Send push & in-app notification to SuperAdmin
      notifySuperAdminAndAdmins(
        '🗑️ Stock Deletion Approval Required',
        `User "${req.user.name || 'Staff'}" requested deletion of ${itemType} "${itemName}". SuperAdmin approval required.`,
        null,
        { requestId: deleteReq._id.toString(), itemType, itemId: itemId.toString() },
        'stock_alert'
      ).catch(err => console.error('[Notification Error]:', err.message));

      return res.status(200).json({
        status: 'success',
        isPendingApproval: true,
        message: `Deletion request for ${itemType} "${itemName}" submitted to SuperAdmin for approval. Data will be deleted once approved.`,
        data: deleteReq
      });
    } else {
      // SuperAdmin direct deletion: Log full snapshot in StockDeleteRequest for permanent history, then delete
      await StockDeleteRequest.create({
        itemType,
        itemId: item._id,
        itemName,
        itemDetails,
        itemData: item,
        reason: deleteReason,
        requestedBy: req.user._id,
        requestedByModel: 'Admin',
        status: 'approved',
        actionBy: req.user._id,
        actionByModel: 'Admin',
        actionAt: new Date(),
        actionRemarks: 'Directly deleted by SuperAdmin'
      });

      await Model.findByIdAndDelete(itemId);
      return res.status(200).json({
        status: 'success',
        message: `${itemType} "${itemName}" deleted successfully and deletion history recorded.`
      });
    }
  } catch (error) {
    next(error);
  }
};

// --- Default Data Seeder ---
export const seedStockMetadata = async (req, res, next) => {
  try {
    const catCount = await Category.countDocuments();
    let seededCategories = [];
    if (catCount === 0) {
      seededCategories = await Category.insertMany([
        { name: 'Electronics', code: 'CAT-ELE', description: 'Electronic items & gadgets', status: 'active' },
        { name: 'Hardware & Tools', code: 'CAT-HDW', description: 'Hardware equipment and tools', status: 'active' },
        { name: 'Home & Office Appliances', code: 'CAT-APP', description: 'Electrical appliances', status: 'active' },
        { name: 'Raw Materials', code: 'CAT-RAW', description: 'Industrial raw materials', status: 'active' },
        { name: 'Office Supplies', code: 'CAT-SUP', description: 'Consumables & stationery', status: 'active' },
        { name: 'Spare Parts', code: 'CAT-SPR', description: 'Component spare parts', status: 'active' },
      ]);
    }

    const brandCount = await Brand.countDocuments();
    let seededBrands = [];
    if (brandCount === 0) {
      seededBrands = await Brand.insertMany([
        { name: 'Samsung', code: 'BR-SAM', description: 'Samsung Electronics', status: 'active' },
        { name: 'LG Electronics', code: 'BR-LGE', description: 'LG Electronics', status: 'active' },
        { name: 'Bosch', code: 'BR-BSC', description: 'Bosch Tools & Technology', status: 'active' },
        { name: 'Tata', code: 'BR-TAT', description: 'Tata Enterprise', status: 'active' },
        { name: 'HP', code: 'BR-HPP', description: 'Hewlett-Packard', status: 'active' },
        { name: 'Dell', code: 'BR-DEL', description: 'Dell Inc', status: 'active' },
        { name: 'Philips', code: 'BR-PHI', description: 'Philips Consumer', status: 'active' },
        { name: 'Havells', code: 'BR-HAV', description: 'Havells Electricals', status: 'active' },
        { name: 'Schneider Electric', code: 'BR-SCH', description: 'Schneider Industrial', status: 'active' },
      ]);
    }

    const unitCount = await Unit.countDocuments();
    let seededUnits = [];
    if (unitCount === 0) {
      seededUnits = await Unit.insertMany([
        { name: 'Pieces', shortName: 'pcs', status: 'active' },
        { name: 'Kilograms', shortName: 'kg', status: 'active' },
        { name: 'Meters', shortName: 'm', status: 'active' },
        { name: 'Boxes', shortName: 'box', status: 'active' },
        { name: 'Liters', shortName: 'ltr', status: 'active' },
        { name: 'Sets', shortName: 'set', status: 'active' },
        { name: 'Packs', shortName: 'pack', status: 'active' },
      ]);
    }

    const whCount = await Warehouse.countDocuments();
    let seededWarehouses = [];
    if (whCount === 0) {
      seededWarehouses = await Warehouse.insertMany([
        { name: 'Main Central Warehouse', code: 'WH-MAIN', city: 'Mumbai', managerName: 'Store Head', status: 'active' },
        { name: 'Branch Depot A', code: 'WH-DEP-A', city: 'Delhi', managerName: 'Depot Manager', status: 'active' },
        { name: 'Regional Storage B', code: 'WH-REG-B', city: 'Bangalore', managerName: 'Stock Supervisor', status: 'active' },
      ]);
    }

    res.status(200).json({
      status: 'success',
      message: 'Initial stock metadata seeded successfully',
      data: { seededCategories, seededBrands, seededUnits, seededWarehouses },
    });
  } catch (error) {
    next(error);
  }
};

// --- Dashboard Stats ---
export const getDashboardStats = async (req, res, next) => {
  try {
    const totalProducts = await Product.countDocuments();
    const activeProducts = await Product.countDocuments({ status: 'active' });
    const totalCategories = await Category.countDocuments({ status: 'active' });
    const totalBrands = await Brand.countDocuments({ status: 'active' });
    const totalWarehouses = await Warehouse.countDocuments({ status: 'active' });

    const products = await Product.find({ status: 'active' });
    let totalStockQuantity = 0;
    let totalStockValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    products.forEach((p) => {
      totalStockQuantity += p.currentStock || 0;
      totalStockValue += (p.currentStock || 0) * (p.purchasePrice || 0);
      if ((p.currentStock || 0) <= 0) {
        outOfStockCount++;
      } else if ((p.currentStock || 0) <= (p.minStockLevel || 5)) {
        lowStockCount++;
      }
    });

    const recentMovements = await StockMovement.find()
      .populate('product', 'name sku unit')
      .populate('warehouse', 'name')
      .populate('salesPerson', 'name email phone')
      .populate({
        path: 'lead',
        select: 'name phone email invoiceUrl awbNumber assignedTo',
        populate: { path: 'assignedTo', select: 'name email phone' }
      })
      .sort({ createdAt: -1 })
      .limit(7);

    res.status(200).json({
      status: 'success',
      data: {
        totalProducts,
        activeProducts,
        totalCategories,
        totalBrands,
        totalWarehouses,
        totalStockQuantity,
        totalStockValue,
        lowStockCount,
        outOfStockCount,
        recentMovements,
      },
    });
  } catch (error) {
    next(error);
  }
};

// --- Category Controllers ---
export const getCategories = async (req, res, next) => {
  try {
    const categories = await Category.find().sort({ createdAt: -1 });
    res.status(200).json({ status: 'success', data: categories });
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const { name, code, description, status } = req.body;
    const category = await Category.create({ name, code, description, status });
    res.status(201).json({ status: 'success', data: category });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!category) return res.status(404).json({ status: 'fail', message: 'Category not found' });
    res.status(200).json({ status: 'success', data: category });
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req, res, next) => {
  return handleItemDeleteRequest({ itemType: 'Category', itemId: req.params.id, req, res, next });
};

// --- Brand Controllers ---
export const getBrands = async (req, res, next) => {
  try {
    const brands = await Brand.find().sort({ createdAt: -1 });
    res.status(200).json({ status: 'success', data: brands });
  } catch (error) {
    next(error);
  }
};

export const createBrand = async (req, res, next) => {
  try {
    const { name, code, description, status } = req.body;
    const brand = await Brand.create({ name, code, description, status });
    res.status(201).json({ status: 'success', data: brand });
  } catch (error) {
    next(error);
  }
};

export const updateBrand = async (req, res, next) => {
  try {
    const brand = await Brand.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!brand) return res.status(404).json({ status: 'fail', message: 'Brand not found' });
    res.status(200).json({ status: 'success', data: brand });
  } catch (error) {
    next(error);
  }
};

export const deleteBrand = async (req, res, next) => {
  return handleItemDeleteRequest({ itemType: 'Brand', itemId: req.params.id, req, res, next });
};

// --- Unit Controllers ---
export const getUnits = async (req, res, next) => {
  try {
    const units = await Unit.find().sort({ createdAt: -1 });
    res.status(200).json({ status: 'success', data: units });
  } catch (error) {
    next(error);
  }
};

export const createUnit = async (req, res, next) => {
  try {
    const { name, shortName, status } = req.body;
    const unit = await Unit.create({ name, shortName, status });
    res.status(201).json({ status: 'success', data: unit });
  } catch (error) {
    next(error);
  }
};

export const updateUnit = async (req, res, next) => {
  try {
    const unit = await Unit.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!unit) return res.status(404).json({ status: 'fail', message: 'Unit not found' });
    res.status(200).json({ status: 'success', data: unit });
  } catch (error) {
    next(error);
  }
};

export const deleteUnit = async (req, res, next) => {
  return handleItemDeleteRequest({ itemType: 'Unit', itemId: req.params.id, req, res, next });
};

// --- Warehouse Controllers ---
export const getWarehouses = async (req, res, next) => {
  try {
    const warehouses = await Warehouse.find().sort({ createdAt: -1 });
    res.status(200).json({ status: 'success', data: warehouses });
  } catch (error) {
    next(error);
  }
};

export const createWarehouse = async (req, res, next) => {
  try {
    const { name, code, address, city, phone, managerName, status } = req.body;
    const warehouse = await Warehouse.create({ name, code, address, city, phone, managerName, status });
    res.status(201).json({ status: 'success', data: warehouse });
  } catch (error) {
    next(error);
  }
};

export const updateWarehouse = async (req, res, next) => {
  try {
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!warehouse) return res.status(404).json({ status: 'fail', message: 'Warehouse not found' });
    res.status(200).json({ status: 'success', data: warehouse });
  } catch (error) {
    next(error);
  }
};

export const deleteWarehouse = async (req, res, next) => {
  return handleItemDeleteRequest({ itemType: 'Warehouse', itemId: req.params.id, req, res, next });
};

// --- Product Controllers ---
export const getProducts = async (req, res, next) => {
  try {
    const { search, category, brand, status, lowStock } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }
    if (category) filter.category = category;
    if (brand) filter.brand = brand;
    if (status) filter.status = status;

    let products = await Product.find(filter)
      .populate('category', 'name code')
      .populate('brand', 'name code')
      .populate('unit', 'name shortName')
      .populate('warehouseStock.warehouse', 'name code')
      .sort({ createdAt: -1 });

    if (lowStock === 'true') {
      products = products.filter((p) => p.currentStock <= p.minStockLevel);
    }

    res.status(200).json({ status: 'success', count: products.length, data: products });
  } catch (error) {
    next(error);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category', 'name code')
      .populate('brand', 'name code')
      .populate('unit', 'name shortName')
      .populate('warehouseStock.warehouse', 'name code');

    if (!product) return res.status(404).json({ status: 'fail', message: 'Product not found' });

    res.status(200).json({ status: 'success', data: product });
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const {
      sku,
      name,
      category,
      brand,
      unit,
      purchasePrice,
      sellingPrice,
      minStockLevel,
      openingStock,
      description,
      status,
      warehouseId,
    } = req.body;

    const initialQty = Number(openingStock) || 0;
    let warehouseStock = [];

    if (warehouseId && initialQty > 0) {
      warehouseStock.push({ warehouse: warehouseId, quantity: initialQty });
    }

    const product = await Product.create({
      sku: sku || `SKU-${Date.now().toString().slice(-6)}`,
      name,
      category,
      brand: brand || null,
      unit,
      purchasePrice: Number(purchasePrice) || 0,
      sellingPrice: Number(sellingPrice) || 0,
      minStockLevel: Number(minStockLevel) || 5,
      currentStock: initialQty,
      openingStock: initialQty,
      warehouseStock,
      description,
      status: status || 'active',
    });

    if (initialQty > 0) {
      await StockMovement.create({
        transactionType: 'opening_stock',
        product: product._id,
        warehouse: warehouseId || null,
        quantity: initialQty,
        unitPrice: Number(purchasePrice) || 0,
        totalPrice: initialQty * (Number(purchasePrice) || 0),
        referenceNo: 'INIT-OP-' + product.sku,
        notes: 'Initial opening stock entry upon product creation',
        performedBy: req.user._id,
        performerModel: req.user.role === 'superAdmin' || req.user.role === 'admin' ? 'Admin' : 'User',
      });
    }

    res.status(201).json({ status: 'success', data: product });
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ status: 'fail', message: 'Product not found' });
    res.status(200).json({ status: 'success', data: product });
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  return handleItemDeleteRequest({ itemType: 'Product', itemId: req.params.id, req, res, next });
};

// --- Bulk Product Import (Excel / CSV) ---
export const bulkImportProducts = async (req, res, next) => {
  try {
    const { products: items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ status: 'fail', message: 'No items provided for bulk import' });
    }

    // Default fallbacks
    let defaultCat = await Category.findOne({ status: 'active' });
    if (!defaultCat) {
      defaultCat = await Category.create({ name: 'General Category', code: 'CAT-GEN', status: 'active' });
    }

    let defaultUnit = await Unit.findOne({ status: 'active' });
    if (!defaultUnit) {
      defaultUnit = await Unit.create({ name: 'Pieces', shortName: 'pcs', status: 'active' });
    }

    const createdProducts = [];
    for (const item of items) {
      if (!item.name && !item.Name) continue;

      const pName = item.name || item.Name;
      const pSku = item.sku || item.SKU || `SKU-IMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const pPurchasePrice = Number(item.purchasePrice || item.PurchasePrice || item['Purchase Price']) || 0;
      const pSellingPrice = Number(item.sellingPrice || item.SellingPrice || item['Selling Price']) || 0;
      const pMinStock = Number(item.minStockLevel || item.MinStockLevel || item['Min Stock Level']) || 5;
      const pOpeningStock = Number(item.openingStock || item.OpeningStock || item['Opening Stock']) || 0;
      const pDesc = item.description || item.Description || 'Imported via Excel sheet';

      // Auto resolve Category
      let itemCatId = defaultCat._id;
      const catInput = item.category || item.Category;
      if (catInput) {
        const foundCat = await Category.findOne({
          $or: [{ _id: catInput.match(/^[0-9a-fA-F]{24}$/) ? catInput : null }, { name: new RegExp('^' + catInput + '$', 'i') }],
        });
        if (foundCat) {
          itemCatId = foundCat._id;
        } else {
          const newCat = await Category.create({ name: catInput, code: `CAT-${Date.now().toString().slice(-4)}` });
          itemCatId = newCat._id;
        }
      }

      // Auto resolve Brand
      let itemBrandId = null;
      const brandInput = item.brand || item.Brand;
      if (brandInput) {
        const foundBrand = await Brand.findOne({
          $or: [{ _id: brandInput.match(/^[0-9a-fA-F]{24}$/) ? brandInput : null }, { name: new RegExp('^' + brandInput + '$', 'i') }],
        });
        if (foundBrand) {
          itemBrandId = foundBrand._id;
        } else {
          const newBrand = await Brand.create({ name: brandInput, code: `BR-${Date.now().toString().slice(-4)}` });
          itemBrandId = newBrand._id;
        }
      }

      // Auto resolve Unit
      let itemUnitId = defaultUnit._id;
      const unitInput = item.unit || item.Unit;
      if (unitInput) {
        const foundUnit = await Unit.findOne({
          $or: [
            { _id: unitInput.match(/^[0-9a-fA-F]{24}$/) ? unitInput : null },
            { name: new RegExp('^' + unitInput + '$', 'i') },
            { shortName: new RegExp('^' + unitInput + '$', 'i') },
          ],
        });
        if (foundUnit) {
          itemUnitId = foundUnit._id;
        } else {
          const newUnit = await Unit.create({ name: unitInput, shortName: unitInput.slice(0, 5).toLowerCase() });
          itemUnitId = newUnit._id;
        }
      }

      const newProduct = await Product.create({
        sku: pSku,
        name: pName,
        category: itemCatId,
        brand: itemBrandId,
        unit: itemUnitId,
        purchasePrice: pPurchasePrice,
        sellingPrice: pSellingPrice,
        minStockLevel: pMinStock,
        currentStock: pOpeningStock,
        openingStock: pOpeningStock,
        description: pDesc,
        status: 'active',
      });

      if (pOpeningStock > 0) {
        await StockMovement.create({
          transactionType: 'opening_stock',
          product: newProduct._id,
          quantity: pOpeningStock,
          unitPrice: pPurchasePrice,
          totalPrice: pOpeningStock * pPurchasePrice,
          referenceNo: 'INIT-OP-' + newProduct.sku,
          notes: 'Bulk Excel import opening stock',
          performedBy: req.user._id,
          performerModel: req.user.role === 'superAdmin' || req.user.role === 'admin' ? 'Admin' : 'User',
        });
      }

      createdProducts.push(newProduct);
    }

    res.status(201).json({
      status: 'success',
      message: `Successfully imported ${createdProducts.length} products`,
      count: createdProducts.length,
      data: createdProducts,
    });
  } catch (error) {
    next(error);
  }
};

// --- Stock Transactions & Entries ---
export const recordStockMovement = async (req, res, next) => {
  try {
    const {
      transactionType,
      productId,
      warehouseId,
      quantity,
      unitPrice,
      referenceNo,
      supplier,
      customer,
      customerPhone,
      salesPerson,
      salesPersonName: rawSalesPersonName,
      invoiceNumber,
      invoiceUrl,
      lead,
      notes,
    } = req.body;

    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      return res.status(400).json({ status: 'fail', message: 'Valid positive quantity is required' });
    }

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ status: 'fail', message: 'Product not found' });

    const price = Number(unitPrice) || product.purchasePrice || 0;
    const totalPrice = qty * price;

    let stockDelta = 0;
    if (['stock_in', 'purchase', 'opening_stock'].includes(transactionType)) {
      stockDelta = qty;
    } else if (transactionType === 'stock_out') {
      stockDelta = -qty;
      if (product.currentStock < qty) {
        return res.status(400).json({ status: 'fail', message: `Insufficient stock! Current stock is ${product.currentStock}` });
      }
    } else if (transactionType === 'adjustment') {
      stockDelta = qty;
    }

    product.currentStock += stockDelta;

    if (warehouseId) {
      const idx = product.warehouseStock.findIndex((w) => w.warehouse.toString() === warehouseId.toString());
      if (idx > -1) {
        product.warehouseStock[idx].quantity += stockDelta;
      } else {
        product.warehouseStock.push({ warehouse: warehouseId, quantity: Math.max(0, stockDelta) });
      }
    }

    await product.save();

    // Trigger Notifications for Fresh Stock or Low Stock Alert
    try {
      if (['stock_in', 'purchase', 'opening_stock'].includes(transactionType)) {
        notifyRoles(
          ['sales', 'calling'],
          '📦 Fresh Stock Added',
          `🎉 New Stock: ${qty} units of "${product.name}" added to inventory (${product.currentStock} units available).`,
          null,
          { productId: product._id.toString() },
          'stock_alert'
        ).catch(err => console.error('[StockNotification Error]:', err.message));
      } else if (['stock_out', 'adjustment'].includes(transactionType)) {
        const threshold = product.minStockAlert !== undefined ? product.minStockAlert : 5;
        if (product.currentStock <= threshold) {
          notifyRoles(
            ['stock', 'accountant', 'superAdmin'],
            '⚠️ Low Stock Alert',
            `⚠️ Low Stock Warning: "${product.name}" has only ${product.currentStock} unit${product.currentStock === 1 ? '' : 's'} remaining in stock!`,
            null,
            { productId: product._id.toString(), currentStock: product.currentStock },
            'stock_alert'
          ).catch(err => console.error('[StockNotification Error]:', err.message));
        }
      }
    } catch (notifErr) {
      console.error('[StockNotification Error]:', notifErr.message);
    }

    let resolvedSalesPersonName = rawSalesPersonName;
    if (salesPerson && !resolvedSalesPersonName) {
      const spUser = await User.findById(salesPerson).select('name').lean();
      if (spUser) resolvedSalesPersonName = spUser.name;
    }

    const movement = await StockMovement.create({
      transactionType,
      product: productId,
      warehouse: warehouseId || null,
      quantity: Math.abs(qty),
      unitPrice: price,
      totalPrice,
      referenceNo: referenceNo || `${transactionType.toUpperCase()}-${Date.now()}`,
      supplier,
      customer,
      customerPhone,
      salesPerson: salesPerson || undefined,
      salesPersonName: resolvedSalesPersonName,
      invoiceNumber,
      invoiceUrl,
      lead: lead || undefined,
      notes,
      performedBy: req.user._id,
      performerModel: req.user.role === 'superAdmin' || req.user.role === 'admin' ? 'Admin' : 'User',
    });

    res.status(201).json({ status: 'success', data: movement, currentStock: product.currentStock });
  } catch (error) {
    next(error);
  }
};

export const getStockMovements = async (req, res, next) => {
  try {
    const { transactionType, product, warehouse, startDate, endDate, search } = req.query;
    const filter = {};

    if (transactionType) filter.transactionType = transactionType;
    if (product) filter.product = product;
    if (warehouse) filter.warehouse = warehouse;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const endD = new Date(endDate);
        endD.setHours(23, 59, 59, 999);
        filter.date.$lte = endD;
      }
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { customer: regex },
        { customerPhone: regex },
        { invoiceNumber: regex },
        { referenceNo: regex },
        { salesPersonName: regex },
        { notes: regex },
        { supplier: regex },
      ];
    }

    const rawMovements = await StockMovement.find(filter)
      .populate('product', 'name sku unit purchasePrice sellingPrice category brand')
      .populate('warehouse', 'name code location')
      .populate('performedBy', 'name email role')
      .populate('salesPerson', 'name email phone role')
      .populate({
        path: 'lead',
        select: 'name phone email invoiceUrl awbNumber assignedTo dealValue address',
        populate: { path: 'assignedTo', select: 'name email phone' }
      })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    // Check if any legacy records have referenceNo 'SALE-<leadId>' without lead populated
    const legacyLeadIds = [];
    rawMovements.forEach((m) => {
      if (!m.lead && m.referenceNo && m.referenceNo.startsWith('SALE-')) {
        const potentialId = m.referenceNo.replace('SALE-', '').trim();
        if (potentialId.match(/^[0-9a-fA-F]{24}$/)) {
          legacyLeadIds.push(potentialId);
        }
      }
    });

    let legacyLeadMap = {};
    if (legacyLeadIds.length > 0) {
      const foundLeads = await Lead.find({ _id: { $in: legacyLeadIds } })
        .populate('assignedTo', 'name email phone')
        .lean();
      foundLeads.forEach((l) => {
        legacyLeadMap[l._id.toString()] = l;
      });
    }

    // Enrich movements with fallback customer, salesPerson, and invoice details
    const movements = rawMovements.map((m) => {
      let linkedLead = m.lead;
      if (!linkedLead && m.referenceNo && m.referenceNo.startsWith('SALE-')) {
        const potentialId = m.referenceNo.replace('SALE-', '').trim();
        if (legacyLeadMap[potentialId]) {
          linkedLead = legacyLeadMap[potentialId];
        }
      }

      const customerName = m.customer || linkedLead?.name || null;
      const customerPhone = m.customerPhone || linkedLead?.phone || null;
      const salesPersonObj = m.salesPerson || linkedLead?.assignedTo || null;
      const salesPersonName = m.salesPersonName || salesPersonObj?.name || (typeof salesPersonObj === 'string' ? salesPersonObj : null);
      const invoiceNumber = m.invoiceNumber || linkedLead?.awbNumber || (m.referenceNo?.startsWith('INV-') ? m.referenceNo : null);
      const invoiceUrl = m.invoiceUrl || linkedLead?.invoiceUrl || null;

      return {
        ...m,
        lead: linkedLead || null,
        customer: customerName,
        customerPhone,
        salesPerson: salesPersonObj,
        salesPersonName,
        invoiceNumber,
        invoiceUrl,
      };
    });

    res.status(200).json({ status: 'success', count: movements.length, data: movements });
  } catch (error) {
    next(error);
  }
};

// --- Import / Export Products ---
export const exportProductsExcel = async (req, res, next) => {
  try {
    const products = await Product.find()
      .populate('category', 'name')
      .populate('brand', 'name')
      .populate('unit', 'shortName');

    const data = products.map((p) => ({
      SKU: p.sku,
      Name: p.name,
      Category: p.category ? p.category.name : '',
      Brand: p.brand ? p.brand.name : '',
      Unit: p.unit ? p.unit.shortName : '',
      'Purchase Price': p.purchasePrice,
      'Selling Price': p.sellingPrice,
      'Current Stock': p.currentStock,
      'Min Stock Level': p.minStockLevel,
      Status: p.status,
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Products_Stock_Report.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
};

// --- Stock Delete Requests & Approval History ---

export const requestStockDelete = async (req, res, next) => {
  try {
    const { itemType, itemId, reason } = req.body;
    if (!itemType || !itemId) {
      return res.status(400).json({ status: 'fail', message: 'itemType and itemId are required' });
    }
    return handleItemDeleteRequest({ itemType, itemId, req, res, next, reason });
  } catch (error) {
    next(error);
  }
};

export const getStockDeleteRequests = async (req, res, next) => {
  try {
    const { status = 'all', itemType, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }
    if (itemType) {
      query.itemType = itemType;
    }
    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [{ itemName: regex }, { itemDetails: regex }, { reason: regex }, { actionRemarks: regex }];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skipNum = (pageNum - 1) * limitNum;

    const total = await StockDeleteRequest.countDocuments(query);
    const requests = await StockDeleteRequest.find(query)
      .populate('requestedBy', 'name email role phone')
      .populate('actionBy', 'name email role phone')
      .sort({ createdAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    res.status(200).json({
      status: 'success',
      count: requests.length,
      total,
      pages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      data: requests,
    });
  } catch (error) {
    next(error);
  }
};

export const actionStockDeleteRequest = async (req, res, next) => {
  try {
    const { action, remarks } = req.body;
    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ status: 'fail', message: 'Valid action (approve or reject) is required' });
    }

    const deleteReq = await StockDeleteRequest.findById(req.params.id);
    if (!deleteReq) {
      return res.status(404).json({ status: 'fail', message: 'Stock delete request not found' });
    }

    if (deleteReq.status !== 'pending') {
      return res.status(400).json({
        status: 'fail',
        message: `This request has already been ${deleteReq.status} by an admin.`
      });
    }

    const actionRemarks = remarks || (action === 'approve' ? 'Approved by Admin' : 'Rejected by Admin');

    if (action === 'approve') {
      const Model = getItemModel(deleteReq.itemType);
      if (Model) {
        await Model.findByIdAndDelete(deleteReq.itemId);
      }
      deleteReq.status = 'approved';
    } else {
      deleteReq.status = 'rejected';
    }

    deleteReq.actionRemarks = actionRemarks;
    deleteReq.actionBy = req.user._id;
    deleteReq.actionByModel = req.user.role === 'admin' || req.user.role === 'superAdmin' ? 'Admin' : 'User';
    deleteReq.actionAt = new Date();
    await deleteReq.save();

    // Send in-app and push notification to the requester
    try {
      if (deleteReq.requestedBy) {
        const notifTitle = action === 'approve' ? '✅ Deletion Request Approved' : '❌ Deletion Request Rejected';
        const notifMsg = action === 'approve'
          ? `Your request to delete ${deleteReq.itemType} "${deleteReq.itemName}" was approved by Admin. Item has been removed.`
          : `Your request to delete ${deleteReq.itemType} "${deleteReq.itemName}" was rejected. Reason: ${actionRemarks}`;

        await Notification.create({
          title: notifTitle,
          message: notifMsg,
          recipient: deleteReq.requestedBy,
          type: 'stock_alert',
        });

        const targetUser = await User.findById(deleteReq.requestedBy).select('fcmToken').lean() ||
          await Admin.findById(deleteReq.requestedBy).select('fcmToken').lean();
        if (targetUser?.fcmToken) {
          await sendPushNotification(targetUser.fcmToken, notifTitle, notifMsg);
        }
      }
    } catch (notifErr) {
      console.error('[Notification Error]:', notifErr.message);
    }

    const populatedReq = await StockDeleteRequest.findById(deleteReq._id)
      .populate('requestedBy', 'name email role phone')
      .populate('actionBy', 'name email role phone');

    res.status(200).json({
      status: 'success',
      message: `Deletion request has been ${action === 'approve' ? 'approved and item deleted' : 'rejected'}.`,
      data: populatedReq,
    });
  } catch (error) {
    next(error);
  }
};

