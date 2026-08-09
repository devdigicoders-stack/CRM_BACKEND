import { Category } from '../models/Category.js';
import { Brand } from '../models/Brand.js';
import { Unit } from '../models/Unit.js';
import { Warehouse } from '../models/Warehouse.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import XLSX from 'xlsx';

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

    // Adjust product currentStock and warehouseStock
    let stockDelta = 0;
    if (['stock_in', 'purchase', 'opening_stock'].includes(transactionType)) {
      stockDelta = qty;
    } else if (transactionType === 'stock_out') {
      stockDelta = -qty;
      if (product.currentStock < qty) {
        return res.status(400).json({ status: 'fail', message: `Insufficient stock! Current stock is ${product.currentStock}` });
      }
    } else if (transactionType === 'adjustment') {
      stockDelta = qty; // can be positive or negative based on input
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
