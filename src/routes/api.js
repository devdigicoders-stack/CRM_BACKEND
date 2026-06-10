import { Router } from 'express';
import { getHealth } from '../controllers/healthController.js';
import * as authController from '../controllers/authController.js';
import * as leadController from '../controllers/leadController.js';
import * as dashboardController from '../controllers/dashboardController.js';
import * as settingsController from '../controllers/settingsController.js';
import * as userController from '../controllers/userController.js';
import * as calendarController from '../controllers/calendarController.js';
import * as notificationController from '../controllers/notificationController.js';
import * as reportController from '../controllers/reportController.js';
import * as accountsController from '../controllers/accountsController.js';
import * as installationController from '../controllers/installationController.js';
import { protect, restrictTo, checkPermission } from '../middlewares/authMiddleware.js';

export const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', getHealth);

// --- Auth Routes ---
apiRouter.post('/auth/register', authController.register);
apiRouter.post('/auth/login', authController.login);
apiRouter.post('/auth/change-password', protect, authController.changePassword);
apiRouter.post('/auth/fcm-token', protect, authController.saveFcmToken);
apiRouter.post('/auth/logout', authController.logout);
apiRouter.get('/profile', protect, authController.getProfile);
apiRouter.put('/profile', protect, authController.uploadProfilePicMiddleware, authController.updateProfile);

// --- Sales Users List (for assignment dropdown - accessible by all) ---
apiRouter.get('/users/sales-list', protect, userController.getSalesUsers);
apiRouter.post('/users/fcm-token', protect, userController.registerFcmToken);

// --- Lead Routes ---
apiRouter.post('/leads', protect, checkPermission('leads'), leadController.createLead);
apiRouter.get('/leads', protect, checkPermission('leads'), leadController.getLeads);
apiRouter.get('/leads/:id', protect, checkPermission('leads'), leadController.getLeadById);
apiRouter.put('/leads/:id', protect, checkPermission('leads'), leadController.updateLead);
apiRouter.put('/leads/:id/assign', protect, restrictTo('superAdmin', 'admin', 'calling', 'crmuser'), checkPermission('leads'), leadController.assignLead);
apiRouter.post('/leads/:id/remarks', protect, checkPermission('leads'), leadController.addRemark);
apiRouter.put('/leads/:id/sale-details', protect, checkPermission('leads'), leadController.updateSaleDetails);
apiRouter.put('/leads/:id/sale-documents', protect, checkPermission('leads'), leadController.uploadAgreementMiddleware, leadController.uploadSaleDocuments);
apiRouter.put('/leads/:id/transfer-to-accounts', protect, checkPermission('leads'), leadController.transferToAccounts);
apiRouter.put('/leads/:id/delivery', protect, checkPermission('leads'), leadController.updateDeliveryStatus);

// --- Dashboard Routes ---
apiRouter.get('/dashboard/stats', protect, checkPermission('dashboard'), dashboardController.getDashboardStats);
apiRouter.get('/dashboard/reminders/today', protect, checkPermission('dashboard'), dashboardController.getTodayReminders);
apiRouter.get('/dashboard/reminders/missed', protect, checkPermission('dashboard'), dashboardController.getMissedFollowUps);
apiRouter.get('/dashboard/performance', protect, restrictTo('superAdmin', 'admin', 'manager'), checkPermission('dashboard'), dashboardController.getPerformanceAnalytics);

// --- Settings Routes ---
apiRouter.get('/settings', protect, checkPermission('settings'), settingsController.getSettings);
apiRouter.put('/settings', protect, restrictTo('superAdmin', 'admin'), checkPermission('settings'), settingsController.updateSettings);

// --- User Management Routes ---
apiRouter.post('/users', protect, restrictTo('superAdmin', 'admin'), checkPermission('users'), userController.createUser);
apiRouter.get('/users', protect, restrictTo('superAdmin', 'admin'), checkPermission('users'), userController.getUsers);
apiRouter.get('/users/:id', protect, restrictTo('superAdmin', 'admin'), checkPermission('users'), userController.getUserById);
apiRouter.put('/users/:id', protect, restrictTo('superAdmin', 'admin'), checkPermission('users'), userController.updateUser);
apiRouter.put('/users/:id/password', protect, restrictTo('superAdmin'), userController.updateUserPassword);
apiRouter.put('/users/:id/toggle-status', protect, restrictTo('superAdmin', 'admin'), checkPermission('users'), userController.toggleUserStatus);
apiRouter.put('/users/:id/permissions', protect, restrictTo('superAdmin'), userController.updateUserPermissions);
apiRouter.delete('/users/:id', protect, restrictTo('superAdmin'), userController.deleteUser);

// --- Calendar Routes ---
apiRouter.get('/calendar', protect, calendarController.getCalendarLeads);

// --- Notification Routes ---
apiRouter.get('/notifications', protect, notificationController.getNotifications);
apiRouter.put('/notifications/:id/read', protect, notificationController.markAsRead);

// --- Report Export Routes ---
apiRouter.get('/reports/export/excel', protect, restrictTo('superAdmin', 'admin', 'manager'), checkPermission('reports'), reportController.exportLeadsExcel);
apiRouter.get('/reports/export/pdf', protect, restrictTo('superAdmin', 'admin', 'manager'), checkPermission('reports'), reportController.exportLeadsPdf);

// --- Accounts (Accountant Panel) Routes ---
apiRouter.get('/accounts/dashboard', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('accounts'), accountsController.getAccountDashboard);
apiRouter.get('/accounts/leads', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('accounts'), accountsController.getClosedWonLeads);
apiRouter.put('/accounts/leads/:id/verify', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('accounts'), accountsController.verifySale);
apiRouter.put('/accounts/leads/:id/invoice', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('accounts'), accountsController.uploadInvoiceMiddleware, accountsController.uploadInvoice);
apiRouter.put('/accounts/leads/:id/payment', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('accounts'), accountsController.updatePaymentAndTransaction);
apiRouter.put('/accounts/leads/:id/tracking', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('accounts'), accountsController.updateTrackingId);
apiRouter.put('/accounts/leads/:id/transfer', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('accounts'), accountsController.transferToInstallation);

// --- Installation (Installation Panel) Routes ---
apiRouter.get('/installation/dashboard', protect, restrictTo('superAdmin', 'admin', 'installation'), checkPermission('installation'), installationController.getInstallationDashboard);
apiRouter.get('/installation/leads', protect, restrictTo('superAdmin', 'admin', 'installation'), checkPermission('installation'), installationController.getAssignedInstallationLeads);
apiRouter.put('/installation/leads/:id/assign-rep', protect, restrictTo('superAdmin', 'admin', 'accountant'), checkPermission('installation'), installationController.assignInstallationRep);
apiRouter.put('/installation/leads/:id/status', protect, restrictTo('superAdmin', 'admin', 'installation'), checkPermission('installation'), installationController.updateInstallationStatus);
apiRouter.put('/installation/leads/:id/proof', protect, restrictTo('superAdmin', 'admin', 'installation'), checkPermission('installation'), installationController.uploadProofMiddleware, installationController.uploadInstallationProof);
apiRouter.put('/installation/leads/:id/issue', protect, restrictTo('superAdmin', 'admin', 'installation'), checkPermission('installation'), installationController.reportInstallationIssue);

