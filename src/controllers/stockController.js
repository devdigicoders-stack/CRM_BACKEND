import { Category } from '../models/Category.js';
import { Brand } from '../models/Brand.js';
import { Unit } from '../models/Unit.js';
import { Warehouse } from '../models/Warehouse.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import XLSX from 'xlsx';

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
      .populate('product', 'name sku')
      .populate('warehouse', 'name')
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
    let categories = await Category.find().sort({ createdAt: -1 });
    if (categories.length === 0) {
      await Category.insertMany([
        { name: 'Electronics', code: 'CAT-ELE', description: 'Electronic items & gadgets', status: 'active' },
        { name: 'Hardware & Tools', code: 'CAT-HDW', description: 'Hardware equipment and tools', status: 'active' },
        { name: 'Home & Office Appliances', code: 'CAT-APP', description: 'Electrical appliances', status: 'active' },
        { name: 'Raw Materials', code: 'CAT-RAW', description: 'Industrial raw materials', status: 'active' },
        { name: 'Office Supplies', code: 'CAT-SUP', description: 'Consumables & stationery', status: 'active' },
        { name: 'Spare Parts', code: 'CAT-SPR', description: 'Component spare parts', status: 'active' },
      ]);
      categories = await Category.find().sort({ createdAt: -1 });
    }
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
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Category deleted' });
  } catch (error) {
    next(error);
  }
};

// --- Brand Controllers ---
export const getBrands = async (req, res, next) => {
  try {
    let brands = await Brand.find().sort({ createdAt: -1 });
    if (brands.length === 0) {
      await Brand.insertMany([
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
      brands = await Brand.find().sort({ createdAt: -1 });
    }
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
  try {
    await Brand.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Brand deleted' });
  } catch (error) {
    next(error);
  }
};

// --- Unit Controllers ---
export const getUnits = async (req, res, next) => {
  try {
    let units = await Unit.find().sort({ createdAt: -1 });
    if (units.length === 0) {
      await Unit.insertMany([
        { name: 'Pieces', shortName: 'pcs', status: 'active' },
        { name: 'Kilograms', shortName: 'kg', status: 'active' },
        { name: 'Meters', shortName: 'm', status: 'active' },
        { name: 'Boxes', shortName: 'box', status: 'active' },
        { name: 'Liters', shortName: 'ltr', status: 'active' },
        { name: 'Sets', shortName: 'set', status: 'active' },
        { name: 'Packs', shortName: 'pack', status: 'active' },
      ]);
      units = await Unit.find().sort({ createdAt: -1 });
    }
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
  try {
    await Unit.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Unit deleted' });
  } catch (error) {
    next(error);
  }
};

// --- Warehouse Controllers ---
export const getWarehouses = async (req, res, next) => {
  try {
    let warehouses = await Warehouse.find().sort({ createdAt: -1 });
    if (warehouses.length === 0) {
      await Warehouse.insertMany([
        { name: 'Main Central Warehouse', code: 'WH-MAIN', city: 'Mumbai', managerName: 'Store Head', status: 'active' },
        { name: 'Branch Depot A', code: 'WH-DEP-A', city: 'Delhi', managerName: 'Depot Manager', status: 'active' },
        { name: 'Regional Storage B', code: 'WH-REG-B', city: 'Bangalore', managerName: 'Stock Supervisor', status: 'active' },
      ]);
      warehouses = await Warehouse.find().sort({ createdAt: -1 });
    }
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
  try {
    await Warehouse.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Warehouse deleted' });
  } catch (error) {
    next(error);
  }
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
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Product deleted' });
  } catch (error) {
    next(error);
  }
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
    const { transactionType, productId, warehouseId, quantity, unitPrice, referenceNo, supplier, customer, notes } = req.body;

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
    const { transactionType, product, warehouse, startDate, endDate } = req.query;
    const filter = {};

    if (transactionType) filter.transactionType = transactionType;
    if (product) filter.product = product;
    if (warehouse) filter.warehouse = warehouse;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const movements = await StockMovement.find(filter)
      .populate('product', 'name sku')
      .populate('warehouse', 'name code')
      .populate('performedBy', 'name email')
      .sort({ date: -1 });

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
