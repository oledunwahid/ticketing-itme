/* ==========================================================================
   OmniDesk - Frontend Logic Script
   ========================================================================== */

// --- Global Application State ---
const state = {
  isAuthenticated: false,
  user: null,
  activeSection: 'section-dashboard',
  tickets: [],
  selectedTicketId: null,
  filters: {
    status: '',
    priority: '',
    search: ''
  },
  stats: {
    total: 0,
    new: 0,
    open: 0,
    pending: 0,
    solved: 0,
    closed: 0,
    urgent: 0
  }
};

// --- DOM Elements ---
const elements = {
  // Navigation
  navDashboard: document.getElementById('btn-nav-dashboard'),
  navTickets: document.getElementById('btn-nav-tickets'),
  navCreate: document.getElementById('btn-nav-create'),
  navItems: document.querySelectorAll('.nav-item'),
  sections: document.querySelectorAll('.content-section'),
  
  // Header controls
  globalSearch: document.getElementById('global-search'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnNewTicketModal: document.getElementById('btn-new-ticket-modal'),
  
  // Dashboard metrics
  statTotal: document.getElementById('stat-total-val'),
  statOpen: document.getElementById('stat-open-val'),
  statPending: document.getElementById('stat-pending-val'),
  statUrgent: document.getElementById('stat-urgent-val'),
  distNew: document.getElementById('dist-new'),
  distOpen: document.getElementById('dist-open'),
  distPending: document.getElementById('dist-pending'),
  distSolved: document.getElementById('dist-solved'),
  distClosed: document.getElementById('dist-closed'),
  urgentMiniList: document.getElementById('urgent-mini-list'),
  btnViewAllTickets: document.querySelector('.btn-view-all-tickets'),
  
  // Tickets View
  filterStatus: document.getElementById('filter-status'),
  filterPriority: document.getElementById('filter-priority'),
  btnClearFilters: document.getElementById('btn-clear-filters'),
  ticketsTableBody: document.getElementById('tickets-table-body'),
  ticketsEmptyState: document.getElementById('tickets-empty-state'),
  searchIndicator: document.getElementById('search-indicator'),
  searchTerm: document.getElementById('search-term'),
  
  // Details Pane
  detailPanel: document.getElementById('ticket-detail-panel'),
  detailEmptyState: document.getElementById('detail-empty-state'),
  detailContent: document.getElementById('detail-content'),
  
  // Create Modal
  modalOverlay: document.getElementById('create-ticket-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  btnCancelModal: document.getElementById('btn-cancel-modal'),
  createFormModal: document.getElementById('create-ticket-form-modal'),
  
  // Create Inline
  createFormInline: document.getElementById('create-ticket-form-inline'),
  btnCancelCreate: document.querySelector('.btn-cancel-create'),
  
  // Toast container
  toastContainer: document.getElementById('toast-container'),

  // Theme Toggle
  themeToggle: document.getElementById('theme-toggle'),

  // User Management
  navUsers: document.getElementById('btn-nav-users'),
  usersTableBody: document.getElementById('users-table-body'),
  usersEmptyState: document.getElementById('users-empty-state'),
  btnCreateUser: document.getElementById('btn-add-user'),
  userModal: document.getElementById('user-modal'),
  btnCloseUserModal: document.getElementById('btn-close-user-modal'),
  btnCancelUserModal: document.getElementById('btn-cancel-user-modal'),
  formUser: document.getElementById('form-user'),
  userModalTitle: document.getElementById('user-modal-title'),
  userIdField: document.getElementById('user-id-field'),
  userUsernameField: document.getElementById('user-username-field'),
  userEmailField: document.getElementById('user-email-field'),
  userPasswordField: document.getElementById('user-password-field'),
  userPasswordGroup: document.getElementById('user-password-group'),
  userRoleField: document.getElementById('user-role-field'),
  userBrandField: document.getElementById('user-brand-field'),
  userPasswordComplexity: document.getElementById('user-password-complexity'),

  // Reports View
  navReports: document.getElementById('btn-nav-reports'),
  reportStatus: document.getElementById('report-status'),
  reportStartDate: document.getElementById('report-start-date'),
  reportEndDate: document.getElementById('report-end-date'),
  reportCustomer: document.getElementById('report-customer'),
  reportAgent: document.getElementById('report-agent'),
  btnGenerateReport: document.getElementById('btn-generate-report'),
  btnResetReportFilters: document.getElementById('btn-reset-report-filters'),
  reportResultsContainer: document.getElementById('report-results-container'),
  reportTableBody: document.getElementById('report-table-body'),
  reportEmptyState: document.getElementById('report-empty-state'),
  btnExportPDF: document.getElementById('btn-export-pdf'),
  btnExportExcel: document.getElementById('btn-export-excel')
};

// Global attachment uploader instances
let inlineUploader;
let modalUploader;

// --- Theme Manager Utility ---
function updateThemeIcon(isLight) {
  const sunIcon = document.querySelector('.theme-icon-sun');
  const moonIcon = document.querySelector('.theme-icon-moon');
  if (sunIcon && moonIcon) {
    if (isLight) {
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    } else {
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    }
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Theme preference
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (savedTheme === 'light' || (!savedTheme && !prefersDark)) {
    document.body.classList.add('light-theme');
    updateThemeIcon(true);
  } else {
    updateThemeIcon(false);
  }

  // Initialize uploaders
  inlineUploader = new AttachmentUploader('inline-upload-zone', 'inline-file-input', 'inline-preview-list');
  modalUploader = new AttachmentUploader('modal-upload-zone', 'modal-file-input', 'modal-preview-list');

  setupEventListeners();

  // Verify authentication first, then route
  await checkAuth();
  handleRouting();
});

// --- API Helper Functions ---
const api = {
  baseUrl: '/api',

  async request(url, options = {}) {
    let res = await fetch(url, { credentials: 'include', ...options });
    
    // Intercept 401 Unauthorized
    if (res.status === 401) {
      if (url.includes('/api/auth/login') || url.includes('/api/auth/register') || url.includes('/api/auth/me')) {
        return res;
      }

      if (state.isAuthenticated) {
        // Trigger mid-session expiry reauth modal
        const success = await openReauthModal();
        if (success) {
          // Retry original request with credentials
          res = await fetch(url, { credentials: 'include', ...options });
        } else {
          throw new Error('Re-authentication cancelled');
        }
      } else {
        // Redirect to login
        navigateTo(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
        throw new Error('Unauthorized');
      }
    }
    
    return res;
  },

  async getStats() {
    const res = await this.request(`${this.baseUrl}/stats`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  async getTickets(filters = {}) {
    const query = new URLSearchParams();
    if (filters.status) query.append('status', filters.status);
    if (filters.priority) query.append('priority', filters.priority);
    if (filters.search) query.append('search', filters.search);
    
    const res = await this.request(`${this.baseUrl}/tickets?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch tickets');
    return res.json();
  },

  async getTicketDetails(id) {
    const res = await this.request(`${this.baseUrl}/tickets/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch ticket details for ID ${id}`);
    return res.json();
  },

  async createTicket(ticketData) {
    const res = await this.request(`${this.baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ticketData)
    });
    if (!res.ok) throw new Error('Failed to create ticket');
    return res.json();
  },

  async updateTicket(id, updateData) {
    const res = await this.request(`${this.baseUrl}/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    if (!res.ok) throw new Error('Failed to update ticket');
    return res.json();
  },

  async addComment(id, commentData) {
    const res = await this.request(`${this.baseUrl}/tickets/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commentData)
    });
    if (!res.ok) throw new Error('Failed to add comment');
    return res.json();
  },

  async getUsers() {
    const res = await this.request(`${this.baseUrl}/users`);
    if (!res.ok) throw new Error('Failed to fetch users');
    return res.json();
  },

  async createUser(userData) {
    const res = await this.request(`${this.baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to create user');
    }
    return res.json();
  },

  async updateUser(id, userData) {
    const res = await this.request(`${this.baseUrl}/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update user');
    }
    return res.json();
  },

  async deleteUser(id) {
    const res = await this.request(`${this.baseUrl}/users/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      let errMsg = 'Failed to delete user';
      try { const d = await res.json(); errMsg = d.error || errMsg; } catch(_) {}
      throw new Error(errMsg);
    }
    return true;
  }
};

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Sidebar Navigation Click
  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-target');
      switchView(target);
    });
  });

  // Top Bar Refresh Button
  elements.btnRefresh.addEventListener('click', () => {
    loadAllData();
    showToast('Dashboard data refreshed', 'info');
  });

  // Modal Open/Close triggers
  elements.btnNewTicketModal.addEventListener('click', () => {
    elements.modalOverlay.classList.add('active');
  });

  const closeModalFunc = () => {
    elements.modalOverlay.classList.remove('active');
    elements.createFormModal.reset();
    if (modalUploader) modalUploader.clearAll();
  };

  elements.btnCloseModal.addEventListener('click', closeModalFunc);
  elements.btnCancelModal.addEventListener('click', closeModalFunc);

  // Modal Submit Form
  elements.createFormModal.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (modalUploader && modalUploader.isUploading()) {
      showToast('Please wait for all attachments to finish uploading.', 'error');
      return;
    }

    const submitBtn = elements.createFormModal.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Creating...';

    const ticketData = {
      customer_name: document.getElementById('modal-customer-name').value,
      customer_email: document.getElementById('modal-customer-email').value,
      title: document.getElementById('modal-ticket-title').value,
      priority: document.getElementById('modal-ticket-priority').value,
      description: document.getElementById('modal-ticket-description').value,
      attachmentIds: modalUploader ? modalUploader.getUploadedIds() : []
    };

    try {
      await api.createTicket(ticketData);
      showToast('Support ticket logged successfully', 'success');
      if (modalUploader) modalUploader.attachments = []; // clear tracking (files are saved)
      closeModalFunc();
      loadAllData();
      switchView('section-tickets');
    } catch (err) {
      console.error(err);
      showToast('Error creating ticket. Please check input fields.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Create Ticket';
    }
  });

  // Inline Form Cancel/Submit
  elements.btnCancelCreate.addEventListener('click', () => {
    elements.createFormInline.reset();
    if (inlineUploader) inlineUploader.clearAll();
    switchView('section-dashboard');
  });

  elements.createFormInline.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inlineUploader && inlineUploader.isUploading()) {
      showToast('Please wait for all attachments to finish uploading.', 'error');
      return;
    }

    const submitBtn = elements.createFormInline.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerText = 'Creating...';

    const ticketData = {
      customer_name: document.getElementById('inline-customer-name').value,
      customer_email: document.getElementById('inline-customer-email').value,
      title: document.getElementById('inline-ticket-title').value,
      priority: document.getElementById('inline-ticket-priority').value,
      description: document.getElementById('inline-ticket-description').value,
      attachmentIds: inlineUploader ? inlineUploader.getUploadedIds() : []
    };

    try {
      await api.createTicket(ticketData);
      showToast('Support ticket logged successfully', 'success');
      elements.createFormInline.reset();
      if (inlineUploader) inlineUploader.attachments = []; // clear tracking
      loadAllData();
      switchView('section-tickets');
    } catch (err) {
      console.error(err);
      showToast('Error creating ticket.', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Create Ticket';
    }
  });

  // Dashboard View All button
  elements.btnViewAllTickets.addEventListener('click', () => {
    switchView('section-tickets');
  });

  // Filters Controls
  elements.filterStatus.addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    updateFiltersIndicator();
    loadTickets();
  });

  elements.filterPriority.addEventListener('change', (e) => {
    state.filters.priority = e.target.value;
    updateFiltersIndicator();
    loadTickets();
  });

  elements.btnClearFilters.addEventListener('click', () => {
    elements.filterStatus.value = '';
    elements.filterPriority.value = '';
    elements.globalSearch.value = '';
    state.filters.status = '';
    state.filters.priority = '';
    state.filters.search = '';
    updateFiltersIndicator();
    loadTickets();
  });

  // Global Search input (Debounced search on input or instant on enter)
  let searchTimeout;
  elements.globalSearch.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.filters.search = e.target.value;
      updateFiltersIndicator();
      // Auto-navigate to tickets section if search matches
      if (state.activeSection !== 'section-tickets') {
        switchView('section-tickets');
      } else {
        loadTickets();
      }
    }, 400);
  });

  // Theme Toggle Button
  if (elements.themeToggle) {
    elements.themeToggle.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-theme');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      updateThemeIcon(isLight);
      showToast(`${isLight ? 'Light' : 'Dark'} theme activated`, 'info');
    });
  }

  // Go to register link
  const linkGotoRegister = document.getElementById('link-goto-register');
  if (linkGotoRegister) {
    linkGotoRegister.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('/register');
    });
  }

  // Go to login link
  const linkGotoLogin = document.getElementById('link-goto-login');
  if (linkGotoLogin) {
    linkGotoLogin.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('/login');
    });
  }

  // Sign out button
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      handleLogout();
    });
  }

  // Real-time password complexity checklist event listeners
  const regPassword = document.getElementById('register-password');
  const regPasswordConfirm = document.getElementById('register-password-confirm');
  if (regPassword && regPasswordConfirm) {
    const checkComplexity = () => {
      validatePasswordComplexity(regPassword.value, regPasswordConfirm.value);
    };
    regPassword.addEventListener('input', checkComplexity);
    regPasswordConfirm.addEventListener('input', checkComplexity);
  }

  // User Management Event Listeners
  if (elements.navUsers) {
    elements.navUsers.addEventListener('click', () => {
      switchView('section-users');
    });
  }

  // Reports Event Listeners
  if (elements.navReports) {
    elements.navReports.addEventListener('click', () => {
      switchView('section-reports');
    });
  }

  if (elements.btnCreateUser) {
    elements.btnCreateUser.addEventListener('click', () => {
      openUserModal();
    });
  }

  // User search input
  const userSearchInput = document.getElementById('user-search-input');
  if (userSearchInput) {
    let searchDebounce;
    userSearchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        loadUsers(userSearchInput.value.trim());
      }, 250);
    });
  }

  if (elements.btnCloseUserModal) {
    elements.btnCloseUserModal.addEventListener('click', () => {
      closeUserModal();
    });
  }

  if (elements.btnCancelUserModal) {
    elements.btnCancelUserModal.addEventListener('click', () => {
      closeUserModal();
    });
  }

  if (elements.formUser) {
    elements.formUser.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleSaveUser();
    });
  }

  if (elements.userPasswordField) {
    elements.userPasswordField.addEventListener('input', (e) => {
      validateUserPasswordComplexity(e.target.value);
    });
  }

  // Initialize Password Toggle Buttons
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const wrapper = btn.closest('.password-wrapper');
      const input = wrapper.querySelector('input');
      if (input.type === 'password') {
        input.type = 'text';
        wrapper.classList.add('show-password');
      } else {
        input.type = 'password';
        wrapper.classList.remove('show-password');
      }
    });
  });
}

function resetPasswordVisibility() {
  document.querySelectorAll('.password-wrapper').forEach(wrapper => {
    wrapper.classList.remove('show-password');
    const input = wrapper.querySelector('input');
    if (input) {
      input.type = 'password';
    }
  });
}

// --- Navigation & Routing Controllers ---
function navigateTo(path) {
  history.pushState(null, '', path);
  handleRouting();
}

window.addEventListener('popstate', () => {
  handleRouting();
});

async function checkAuth() {
  const loadingScreen = document.getElementById('app-loading');
  if (loadingScreen) loadingScreen.classList.remove('fade-out');

  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const user = await res.json();
      state.isAuthenticated = true;
      state.user = user;
      updateSidebarUI(user);
    } else {
      state.isAuthenticated = false;
      state.user = null;
    }
  } catch (err) {
    console.error('Auth verification failure:', err);
    state.isAuthenticated = false;
    state.user = null;
  } finally {
    if (loadingScreen) {
      setTimeout(() => {
        loadingScreen.classList.add('fade-out');
      }, 300);
    }
  }
}

function handleRouting() {
  resetPasswordVisibility();
  const path = window.location.pathname;
  
  if (path === '/login' || path === '/register') {
    document.body.classList.add('auth-mode');
    if (path === '/login') {
      switchSection('section-login');
    } else {
      switchSection('section-register');
    }
    return;
  }

  document.body.classList.remove('auth-mode');

  if (!state.isAuthenticated) {
    navigateTo(`/login?redirect=${encodeURIComponent(path)}`);
    return;
  }

  // RBAC routing checks
  if (state.user.role === 'Customer' && (path === '/' || path === '/dashboard')) {
    navigateTo('/tickets');
    return;
  }

  if (path === '/' || path === '/dashboard') {
    switchSection('section-dashboard');
  } else if (path === '/tickets') {
    switchSection('section-tickets');
  } else if (path === '/create-ticket') {
    switchSection('section-create');
  } else if (path === '/users') {
    if (state.user && state.user.role === 'Agent') {
      switchSection('section-users');
    } else {
      navigateTo('/tickets');
    }
  } else if (path === '/reports') {
    if (state.user && state.user.role === 'Agent') {
      switchSection('section-reports');
    } else {
      navigateTo('/tickets');
    }
  } else {
    navigateTo(state.user.role === 'Agent' ? '/dashboard' : '/tickets');
  }
}

function switchView(targetId) {
  let path = '/dashboard';
  if (targetId === 'section-tickets') path = '/tickets';
  else if (targetId === 'section-create') path = '/create-ticket';
  else if (targetId === 'section-users') path = '/users';
  else if (targetId === 'section-reports') path = '/reports';
  navigateTo(path);
}

function switchSection(targetId) {
  elements.sections.forEach(section => {
    if (section.id === targetId) {
      section.classList.add('active');
    } else {
      section.classList.remove('active');
    }
  });

  elements.navItems.forEach(item => {
    if (item.getAttribute('data-target') === targetId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  state.activeSection = targetId;
  
  // Re-fetch data if switching to specific lists
  if (targetId === 'section-tickets') {
    loadTickets();
  } else if (targetId === 'section-users') {
    loadUsers();
  } else if (targetId === 'section-reports') {
    loadReportsData();
  } else if (targetId === 'section-dashboard') {
    if (state.user && state.user.role === 'Agent') {
      loadStats();
      loadUrgentTickets();
    }
  }
}

function updateSidebarUI(user) {
  const sidebarName = document.getElementById('sidebar-user-name');
  const sidebarRole = document.getElementById('sidebar-user-role');
  const userAvatar = document.getElementById('user-avatar');
  
  if (sidebarName) sidebarName.innerText = user.username;
  if (sidebarRole) sidebarRole.innerText = user.role;
  if (userAvatar) userAvatar.innerText = user.username.charAt(0).toUpperCase();

  // Hide dashboard button for customers
  const navDashboard = document.getElementById('btn-nav-dashboard');
  if (user.role === 'Customer') {
    if (navDashboard) navDashboard.style.display = 'none';
  } else {
    if (navDashboard) navDashboard.style.display = 'flex';
  }

  // Toggle visibility of the Users & Reports sidebar menu buttons
  const navUsers = document.getElementById('btn-nav-users');
  const navReports = document.getElementById('btn-nav-reports');
  if (user.role === 'Customer') {
    if (navUsers) navUsers.style.display = 'none';
    if (navReports) navReports.style.display = 'none';
  } else {
    if (navUsers) navUsers.style.display = 'flex';
    if (navReports) navReports.style.display = 'flex';
  }
}

// Password validation checking
function validatePasswordComplexity(password, passwordConfirm) {
  const requirements = {
    length: password.length >= 10,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[@$!%*?&]/.test(password),
    match: password === passwordConfirm && password !== ''
  };

  updateComplexityItemUI('req-length', requirements.length);
  updateComplexityItemUI('req-uppercase', requirements.uppercase);
  updateComplexityItemUI('req-lowercase', requirements.lowercase);
  updateComplexityItemUI('req-number', requirements.number);
  updateComplexityItemUI('req-special', requirements.special);
  updateComplexityItemUI('req-match', requirements.match);

  const allMet = Object.values(requirements).every(val => val === true);
  const btnSubmit = document.getElementById('btn-register-submit');
  if (btnSubmit) {
    btnSubmit.disabled = !allMet;
  }
}

function updateComplexityItemUI(elementId, isMet) {
  const el = document.getElementById(elementId);
  if (el) {
    if (isMet) {
      el.classList.add('met');
      el.querySelector('.chk-icon').innerText = '✓';
    } else {
      el.classList.remove('met');
      el.querySelector('.chk-icon').innerText = '✕';
    }
  }
}

// Handle login, logout, registration and reauth forms
const formLogin = document.getElementById('form-login');
if (formLogin) {
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const submitBtn = document.getElementById('btn-login-submit');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Signing in...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        const user = await res.json();
        state.isAuthenticated = true;
        state.user = user;
        updateSidebarUI(user);
        
        showToast('Signed in successfully', 'success');
        
        const searchParams = new URLSearchParams(window.location.search);
        const redirect = searchParams.get('redirect') || (user.role === 'Agent' ? '/dashboard' : '/tickets');
        navigateTo(redirect);
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Invalid email or password', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error during sign in', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Sign In';
    }
  });
}

const formRegister = document.getElementById('form-register');
if (formRegister) {
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const brand = document.getElementById('register-brand').value;
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    const submitBtn = document.getElementById('btn-register-submit');

    submitBtn.disabled = true;
    submitBtn.innerText = 'Registering...';

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password, passwordConfirm, brand })
      });

      if (res.ok) {
        showToast('Account registered successfully! Please sign in.', 'success');
        formRegister.reset();
        validatePasswordComplexity('', ''); 
        navigateTo('/login');
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Registration failed', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error during registration', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'Register Account';
    }
  });
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    state.isAuthenticated = false;
    state.user = null;
    navigateTo('/login');
    showToast('Signed out successfully', 'info');
  }
}

let reauthPromiseResolve = null;

function openReauthModal() {
  return new Promise((resolve) => {
    const reauthModal = document.getElementById('reauth-modal');
    const reauthEmail = document.getElementById('reauth-email');
    const reauthPassword = document.getElementById('reauth-password');
    
    resetPasswordVisibility();
    
    if (reauthEmail) reauthEmail.value = state.user ? state.user.email : '';
    if (reauthPassword) reauthPassword.value = '';
    
    if (reauthModal) reauthModal.classList.add('active');
    if (reauthPassword) reauthPassword.focus();
    
    reauthPromiseResolve = resolve;
  });
}

const formReauth = document.getElementById('form-reauth');
if (formReauth) {
  formReauth.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('reauth-password').value;
    const email = state.user ? state.user.email : '';
    
    const submitBtn = document.getElementById('btn-reauth-submit');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Verifying...';
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (res.ok) {
        const user = await res.json();
        state.isAuthenticated = true;
        state.user = user;
        
        const reauthModal = document.getElementById('reauth-modal');
        if (reauthModal) reauthModal.classList.remove('active');
        
        showToast('Session re-authenticated successfully', 'success');
        if (reauthPromiseResolve) {
          reauthPromiseResolve(true);
          reauthPromiseResolve = null;
        }
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Verification failed. Try again.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error during re-authentication', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Confirm Password';
      }
    }
  });
}

const btnReauthLogout = document.getElementById('btn-reauth-logout');
if (btnReauthLogout) {
  btnReauthLogout.addEventListener('click', async () => {
    const reauthModal = document.getElementById('reauth-modal');
    if (reauthModal) reauthModal.classList.remove('active');
    
    if (reauthPromiseResolve) {
      reauthPromiseResolve(false);
      reauthPromiseResolve = null;
    }
    
    await handleLogout();
  });
}

// --- Data Fetching Operations ---
async function loadAllData() {
  try {
    const promises = [loadTickets()];
    if (state.user && state.user.role === 'Agent') {
      promises.push(loadStats());
      promises.push(loadUrgentTickets());
    }
    await Promise.all(promises);
  } catch (err) {
    console.error('Error loading initialization details:', err);
    showToast('Database sync issues. Please check if node is running.', 'error');
  }
}

async function loadStats() {
  try {
    const stats = await api.getStats();
    state.stats = stats;
    
    // Update Metrics
    elements.statTotal.innerText = stats.total;
    elements.statOpen.innerText = stats.open;
    elements.statPending.innerText = stats.pending;
    elements.statUrgent.innerText = stats.urgent;
    
    // Update Distribution counts
    elements.distNew.innerText = stats.new;
    elements.distOpen.innerText = stats.open;
    elements.distPending.innerText = stats.pending;
    elements.distSolved.innerText = stats.solved;
    elements.distClosed.innerText = stats.closed;
  } catch (err) {
    console.error(err);
  }
}

async function loadUrgentTickets() {
  try {
    // Query tickets with priority Urgent
    const urgentTickets = await api.getTickets({ priority: 'Urgent' });
    
    if (urgentTickets.length === 0) {
      elements.urgentMiniList.innerHTML = `
        <div class="empty-state" style="padding: 20px;">
          <p>No urgent items outstanding. Good job!</p>
        </div>
      `;
      return;
    }

    elements.urgentMiniList.innerHTML = '';
    urgentTickets.slice(0, 3).forEach(ticket => {
      const card = document.createElement('div');
      card.className = 'ticket-mini-card';
      
      const badgeClass = getBadgeClass('status', ticket.status);
      
      card.innerHTML = `
        <div class="ticket-mini-info">
          <span class="ticket-mini-title">${ticket.title}</span>
          <span class="ticket-mini-meta">Logged by ${ticket.customer_name} • ${formatDate(ticket.created_at)}</span>
        </div>
        <span class="badge ${badgeClass}">${ticket.status}</span>
      `;
      
      card.addEventListener('click', () => {
        switchView('section-tickets');
        selectTicket(ticket.id);
      });
      
      elements.urgentMiniList.appendChild(card);
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadTickets() {
  try {
    const tickets = await api.getTickets(state.filters);
    state.tickets = tickets;
    renderTicketsTable(tickets);
  } catch (err) {
    console.error(err);
  }
}

// --- Renderers ---
function renderTicketsTable(tickets) {
  elements.ticketsTableBody.innerHTML = '';
  
  if (tickets.length === 0) {
    elements.ticketsEmptyState.style.display = 'flex';
    return;
  }
  
  elements.ticketsEmptyState.style.display = 'none';

  tickets.forEach(ticket => {
    const row = document.createElement('tr');
    
    // Highlight if active
    if (state.selectedTicketId === ticket.id) {
      row.className = 'active-row';
    }

    const priorityBadge = getBadgeClass('priority', ticket.priority);
    const statusBadge = getBadgeClass('status', ticket.status);

    row.innerHTML = `
      <td>
        <div class="font-semibold" style="color:#fff;">${ticket.title}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top:2px;">#${ticket.id} • ${ticket.assignee_name}</div>
      </td>
      <td>
        <div>${ticket.customer_name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${ticket.customer_email}</div>
      </td>
      <td><span class="badge ${priorityBadge}">${ticket.priority}</span></td>
      <td><span class="badge ${statusBadge}">${ticket.status}</span></td>
      <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(ticket.updated_at)}</td>
    `;

    row.addEventListener('click', () => {
      // Highlight row selection
      const activeRow = elements.ticketsTableBody.querySelector('.active-row');
      if (activeRow) activeRow.classList.remove('active-row');
      row.classList.add('active-row');
      
      selectTicket(ticket.id);
    });

    elements.ticketsTableBody.appendChild(row);
  });
}

async function selectTicket(ticketId) {
  state.selectedTicketId = ticketId;
  
  elements.detailEmptyState.style.display = 'none';
  elements.detailContent.style.display = 'none';
  
  // Show loading indicator
  const detailPanel = elements.detailPanel;
  let loader = detailPanel.querySelector('.loading-state');
  if (!loader) {
    loader = document.createElement('div');
    loader.className = 'loading-state';
    loader.innerHTML = 'Loading ticket details...';
    detailPanel.appendChild(loader);
  } else {
    loader.style.display = 'flex';
  }

  try {
    const { ticket, comments, attachments } = await api.getTicketDetails(ticketId);
    
    // Remove loader
    if (loader) loader.style.display = 'none';
    
    elements.detailContent.innerHTML = renderTicketDetailMarkup(ticket, comments, attachments);
    elements.detailContent.style.display = 'flex';
    
    // Hook up detail action handlers dynamically
    setupDetailActionListeners(ticket);
  } catch (err) {
    console.error(err);
    if (loader) loader.style.display = 'none';
    showToast('Failed to load details.', 'error');
  }
}

function renderTicketDetailMarkup(ticket, comments, attachments = []) {
  const statusBadge = getBadgeClass('status', ticket.status);
  const priorityBadge = getBadgeClass('priority', ticket.priority);
  
  // Process attachments list HTML
  let attachmentsHtml = '';
  if (attachments && attachments.length > 0) {
    attachmentsHtml = `
      <div class="ticket-attachments-section">
        <h4 class="attachments-section-title">Attachments</h4>
        <div class="attachments-list">
    `;
    attachments.forEach(att => {
      const isImage = att.mime_type.startsWith('image/');
      const iconSvg = isImage ? `
        <svg class="attachment-card-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      ` : `
        <svg class="attachment-card-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      `;
      attachmentsHtml += `
        <a href="${att.file_url}" target="_blank" class="attachment-file-card" title="${att.file_name}">
          ${iconSvg}
          <span class="attachment-card-name">${att.file_name}</span>
        </a>
      `;
    });
    attachmentsHtml += `
        </div>
      </div>
    `;
  }

  // Process comments timeline HTML
  let commentsHtml = '';
  if (comments.length === 0) {
    commentsHtml = '<p style="color:var(--text-muted); font-size:0.85rem; font-style:italic;">No agent replies yet.</p>';
  } else {
    comments.forEach(c => {
      let roleClass = 'customer-role';
      if (c.author_role === 'Agent') roleClass = 'agent-role';
      if (c.author_name === 'System') roleClass = 'system-role';

      commentsHtml += `
        <div class="comment-card ${roleClass}">
          <div class="comment-header">
            <span class="comment-author">${c.author_name} 
              <span class="author-role-label">${c.author_role}</span>
            </span>
            <span class="comment-date">${formatDate(c.created_at)}</span>
          </div>
          <div class="comment-text">${c.message}</div>
        </div>
      `;
    });
  }

  return `
    <!-- Top info bar -->
    <div class="detail-header">
      <div class="detail-title-area">
        <h2 class="detail-title">${ticket.title}</h2>
        <div class="detail-meta-row">
          <span>Ticket ID: <strong>#${ticket.id}</strong></span>
          <span>•</span>
          <span>Customer: <strong>${ticket.customer_name}</strong> (${ticket.customer_email})</span>
        </div>
      </div>
      <div style="display:flex; gap: 8px;">
        <span class="badge ${statusBadge}">${ticket.status}</span>
        <span class="badge ${priorityBadge}">${ticket.priority}</span>
      </div>
    </div>

    <!-- Body contents -->
    <div class="detail-body-split">
      
      <!-- Timeline discussion (Left) -->
      <div class="detail-timeline-pane">
        <div class="original-description-box">
          <span class="original-desc-box-label original-desc-label">Original Request</span>
          <div class="comment-text" style="font-size:0.92rem;">${ticket.description}</div>
          <div class="detail-meta-row" style="margin-top:12px; font-size: 0.75rem;">
            <span>Submitted ${formatDate(ticket.created_at)}</span>
          </div>
        </div>
        
        ${attachmentsHtml}
        
        <div class="comments-timeline">
          ${commentsHtml}
        </div>
        
        <!-- Reply form input -->
        <div class="comment-reply-box">
          <div class="reply-input-wrapper">
            <textarea id="reply-message" class="reply-textarea" rows="3" placeholder="Type a response to the customer..."></textarea>
          </div>
          <div class="reply-controls">
            <div class="reply-role-selector">
              <span>Respond as:</span>
              <select id="reply-author-role" class="filter-select" style="padding:4px 8px;">
                <option value="Agent">Agent (Support Desk)</option>
                <option value="Customer">Customer (Emulated Client)</option>
              </select>
            </div>
            <button class="btn btn-primary" id="btn-submit-reply">Send Reply</button>
          </div>
        </div>
      </div>

      <!-- Action Panel (Right) -->
      <div class="detail-actions-pane">
        <h3 class="actions-title">Ticket Options</h3>
        
        <div class="detail-form-group">
          <label for="action-status">Status</label>
          <select id="action-status" class="detail-select-input">
            <option value="New" ${ticket.status === 'New' ? 'selected' : ''}>New</option>
            <option value="Open" ${ticket.status === 'Open' ? 'selected' : ''}>Open</option>
            <option value="Pending" ${ticket.status === 'Pending' ? 'selected' : ''}>Pending</option>
            <option value="Solved" ${ticket.status === 'Solved' ? 'selected' : ''}>Solved</option>
            <option value="Closed" ${ticket.status === 'Closed' ? 'selected' : ''}>Closed</option>
          </select>
        </div>

        <div class="detail-form-group">
          <label for="action-priority">Priority</label>
          <select id="action-priority" class="detail-select-input">
            <option value="Low" ${ticket.priority === 'Low' ? 'selected' : ''}>Low</option>
            <option value="Medium" ${ticket.priority === 'Medium' ? 'selected' : ''}>Medium</option>
            <option value="High" ${ticket.priority === 'High' ? 'selected' : ''}>High</option>
            <option value="Urgent" ${ticket.priority === 'Urgent' ? 'selected' : ''}>Urgent</option>
          </select>
        </div>

        <div class="detail-form-group">
          <label for="action-assignee">Assignee</label>
          <input type="text" id="action-assignee" class="detail-text-input" value="${ticket.assignee_name !== 'Unassigned' ? ticket.assignee_name : ''}" placeholder="Enter agent name...">
        </div>

        <button class="btn btn-secondary btn-update-details" id="btn-save-actions">Apply Changes</button>
      </div>

    </div>
  `;
}

function setupDetailActionListeners(ticket) {
  // 1. Save changes (Status, Priority, Assignee)
  const saveBtn = document.getElementById('btn-save-actions');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.innerText = 'Updating...';
    
    const updateData = {
      status: document.getElementById('action-status').value,
      priority: document.getElementById('action-priority').value,
      assignee_name: document.getElementById('action-assignee').value.trim()
    };

    try {
      await api.updateTicket(ticket.id, updateData);
      showToast(`Ticket #${ticket.id} details saved`, 'success');
      loadStats(); // reload numbers
      loadUrgentTickets(); // reload list
      loadTickets(); // reload grid
      selectTicket(ticket.id); // re-render detail view with log notes
    } catch (err) {
      console.error(err);
      showToast('Error saving updates.', 'error');
      saveBtn.disabled = false;
      saveBtn.innerText = 'Apply Changes';
    }
  });

  // 2. Submit reply/comment
  const replyBtn = document.getElementById('btn-submit-reply');
  replyBtn.addEventListener('click', async () => {
    const textVal = document.getElementById('reply-message').value.trim();
    if (!textVal) {
      showToast('Please type a response before sending.', 'error');
      return;
    }
    
    replyBtn.disabled = true;
    replyBtn.innerText = 'Sending...';

    const authorRole = document.getElementById('reply-author-role').value;
    const authorName = authorRole === 'Agent' ? 'Agent Admin' : ticket.customer_name;

    const commentData = {
      author_name: authorName,
      author_role: authorRole,
      message: textVal
    };

    try {
      await api.addComment(ticket.id, commentData);
      showToast('Response logged on ticket thread', 'success');
      loadStats();
      loadTickets();
      selectTicket(ticket.id); // re-renders conversation timeline
    } catch (err) {
      console.error(err);
      showToast('Error posting response.', 'error');
      replyBtn.disabled = false;
      replyBtn.innerText = 'Send Reply';
    }
  });
}

// --- UI Utility Helper Functions ---
function updateFiltersIndicator() {
  const isFiltered = state.filters.status || state.filters.priority || state.filters.search;
  elements.btnClearFilters.style.display = isFiltered ? 'inline-block' : 'none';

  if (state.filters.search) {
    elements.searchIndicator.style.display = 'block';
    elements.searchTerm.innerText = state.filters.search;
  } else {
    elements.searchIndicator.style.display = 'none';
  }
}

function getBadgeClass(type, value) {
  if (type === 'status') {
    switch (value) {
      case 'New': return 'badge-status-new';
      case 'Open': return 'badge-status-open';
      case 'Pending': return 'badge-status-pending';
      case 'Solved': return 'badge-status-solved';
      case 'Closed': return 'badge-status-closed';
      default: return 'badge-status-new';
    }
  } else {
    switch (value) {
      case 'Low': return 'badge-priority-low';
      case 'Medium': return 'badge-priority-medium';
      case 'High': return 'badge-priority-high';
      case 'Urgent': return 'badge-priority-urgent';
      default: return 'badge-priority-low';
    }
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconMarkup = '';
  if (type === 'success') {
    iconMarkup = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (type === 'error') {
    iconMarkup = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  } else {
    iconMarkup = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }

  toast.innerHTML = `
    ${iconMarkup}
    <span>${message}</span>
  `;
  
  elements.toastContainer.appendChild(toast);
  
  // Animation delay trigger
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  // Auto remove toast
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 350);
  }, 3500);
}

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  
  // Format options
  const diffTime = Math.abs(new Date() - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    // Show time if it's today
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    // Show day name
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    // Show standard date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

// ==========================================================================
// Reusable AttachmentUploader Class for Chunked/Direct Uploads
// ==========================================================================
class AttachmentUploader {
  constructor(zoneId, inputId, previewListId) {
    this.zone = document.getElementById(zoneId);
    this.input = document.getElementById(inputId);
    this.previewList = document.getElementById(previewListId);
    this.attachments = []; // Array of { clientUuid, id, file, name, size, type, state, progress, errorMsg, xhr }
    this.maxFiles = 5;
    this.chunkSize = 2 * 1024 * 1024; // 2MB chunk sizes

    if (this.zone && this.input && this.previewList) {
      this.init();
    }
  }

  init() {
    this.zone.addEventListener('click', (e) => {
      if (e.target !== this.input && !e.target.closest('.preview-card')) {
        this.input.click();
      }
    });

    this.zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.zone.classList.add('dragover');
    });

    this.zone.addEventListener('dragleave', () => {
      this.zone.classList.remove('dragover');
    });

    this.zone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.zone.classList.remove('dragover');
      if (e.dataTransfer.files) {
        this.handleFiles(e.dataTransfer.files);
      }
    });

    this.input.addEventListener('change', (e) => {
      if (e.target.files) {
        this.handleFiles(e.target.files);
      }
    });
  }

  handleFiles(files) {
    Array.from(files).forEach(file => {
      if (this.attachments.length >= this.maxFiles) {
        showToast('Maximum of 5 attachments allowed per ticket.', 'error');
        return;
      }

      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isImage && !isVideo) {
        showToast(`Unsupported file type: ${file.name}`, 'error');
        return;
      }

      if (isImage && file.size > 10 * 1024 * 1024) {
        showToast(`Image exceeds 10MB limit: ${file.name}`, 'error');
        return;
      }

      if (isVideo && file.size > 100 * 1024 * 1024) {
        showToast(`Video exceeds 100MB limit: ${file.name}`, 'error');
        return;
      }

      const clientUuid = Math.random().toString(36).substring(2) + Date.now().toString(36);
      const attachment = {
        clientUuid,
        id: null,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        state: 'uploading',
        progress: 0,
        errorMsg: '',
        xhr: null,
        chunksUploaded: 0,
        totalChunks: 1
      };

      this.attachments.push(attachment);
      this.renderPreview(attachment);
      this.startUpload(attachment);
    });

    this.input.value = '';
  }

  renderPreview(attachment) {
    const card = document.createElement('div');
    card.className = 'preview-card';
    card.id = `preview-${attachment.clientUuid}`;

    const isImage = attachment.type.startsWith('image/');
    
    let mediaMarkup = '';
    if (isImage) {
      mediaMarkup = `<img class="preview-thumbnail" src="" alt="preview" style="display:none;">`;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = card.querySelector('.preview-thumbnail');
        if (img) {
          img.src = e.target.result;
          img.style.display = 'block';
          const icon = card.querySelector('.preview-icon-wrapper');
          if (icon) icon.style.display = 'none';
        }
      };
      reader.readAsDataURL(attachment.file);
    }

    card.innerHTML = `
      <button class="preview-remove-btn" title="Remove attachment" type="button">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <button class="preview-retry-btn" title="Retry upload" type="button" style="display:none;">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>
      <div class="preview-media-container">
        <div class="preview-icon-wrapper">
          ${isImage ? `
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>` : `
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>`
          }
        </div>
        ${mediaMarkup}
      </div>
      <div class="preview-info">
        <span class="preview-name" title="${attachment.name}">${attachment.name}</span>
        <span class="preview-size">${this.formatBytes(attachment.size)}</span>
      </div>
      <div class="preview-progress-container">
        <div class="preview-progress-bar" id="progress-bar-${attachment.clientUuid}"></div>
      </div>
      <span class="preview-error-msg" id="error-${attachment.clientUuid}" style="display:none;"></span>
    `;

    card.querySelector('.preview-remove-btn').addEventListener('click', () => {
      this.removeAttachment(attachment);
    });

    card.querySelector('.preview-retry-btn').addEventListener('click', () => {
      this.retryUpload(attachment);
    });

    this.previewList.appendChild(card);
  }

  updateProgress(attachment, progressVal) {
    attachment.progress = progressVal;
    const bar = document.getElementById(`progress-bar-${attachment.clientUuid}`);
    if (bar) {
      bar.style.width = `${progressVal}%`;
    }
  }

  startUpload(attachment) {
    if (attachment.type.startsWith('video/')) {
      this.uploadChunked(attachment);
    } else {
      this.uploadDirect(attachment);
    }
  }

  uploadDirect(attachment) {
    const xhr = new XMLHttpRequest();
    attachment.xhr = xhr;
    
    xhr.open('POST', '/api/attachments/upload', true);
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        this.updateProgress(attachment, pct);
      }
    });

    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const res = JSON.parse(xhr.responseText);
          attachment.id = res.id;
          attachment.state = 'success';
          this.setSuccessUI(attachment);
        } catch (err) {
          this.setErrorUI(attachment, 'Parse error');
        }
      } else {
        let msg = 'Upload failed';
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch (e) {}
        this.setErrorUI(attachment, msg);
      }
    };

    xhr.onerror = () => {
      this.setErrorUI(attachment, 'Network error');
    };

    const formData = new FormData();
    formData.append('file', attachment.file);
    xhr.send(formData);
  }

  uploadChunked(attachment) {
    const totalChunks = Math.ceil(attachment.size / this.chunkSize);
    attachment.totalChunks = totalChunks;
    attachment.chunksUploaded = 0;
    
    this.uploadNextChunk(attachment);
  }

  uploadNextChunk(attachment) {
    if (attachment.state === 'error') return;

    const start = attachment.chunksUploaded * this.chunkSize;
    const end = Math.min(start + this.chunkSize, attachment.size);
    const chunkBlob = attachment.file.slice(start, end);

    const xhr = new XMLHttpRequest();
    attachment.xhr = xhr;

    xhr.open('POST', '/api/attachments/upload-chunk', true);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const currentChunkPct = e.loaded / e.total;
        const totalProgress = Math.round(
          ((attachment.chunksUploaded + currentChunkPct) / attachment.totalChunks) * 100
        );
        this.updateProgress(attachment, Math.min(totalProgress, 99));
      }
    });

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        attachment.chunksUploaded++;
        
        if (attachment.chunksUploaded < attachment.totalChunks) {
          this.uploadNextChunk(attachment);
        } else {
          try {
            const res = JSON.parse(xhr.responseText);
            attachment.id = res.id;
            attachment.state = 'success';
            this.updateProgress(attachment, 100);
            this.setSuccessUI(attachment);
          } catch (e) {
            this.setErrorUI(attachment, 'Finalize error');
          }
        }
      } else {
        let msg = 'Upload failed';
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch (e) {}
        this.setErrorUI(attachment, msg);
      }
    };

    xhr.onerror = () => {
      this.setErrorUI(attachment, 'Network error');
    };

    const formData = new FormData();
    formData.append('fileId', attachment.clientUuid);
    formData.append('chunkIndex', attachment.chunksUploaded.toString());
    formData.append('totalChunks', attachment.totalChunks.toString());
    formData.append('fileName', attachment.name);
    formData.append('mimeType', attachment.type);
    formData.append('fileSize', attachment.size.toString());
    formData.append('chunk', chunkBlob, attachment.name);

    xhr.send(formData);
  }

  setSuccessUI(attachment) {
    const card = document.getElementById(`preview-${attachment.clientUuid}`);
    if (card) {
      const progressContainer = card.querySelector('.preview-progress-container');
      if (progressContainer) progressContainer.style.display = 'none';
      const retryBtn = card.querySelector('.preview-retry-btn');
      if (retryBtn) retryBtn.style.display = 'none';
      const errorMsg = card.querySelector('.preview-error-msg');
      if (errorMsg) errorMsg.style.display = 'none';
    }
  }

  setErrorUI(attachment, errorMsg) {
    attachment.state = 'error';
    const card = document.getElementById(`preview-${attachment.clientUuid}`);
    if (card) {
      const bar = card.querySelector('.preview-progress-bar');
      if (bar) bar.style.backgroundColor = 'var(--priority-urgent)';
      const retryBtn = card.querySelector('.preview-retry-btn');
      if (retryBtn) retryBtn.style.display = 'block';
      const errorSpan = card.querySelector('.preview-error-msg');
      if (errorSpan) {
        errorSpan.innerText = errorMsg;
        errorSpan.style.display = 'block';
      }
    }
  }

  retryUpload(attachment) {
    attachment.state = 'uploading';
    attachment.progress = 0;
    
    const card = document.getElementById(`preview-${attachment.clientUuid}`);
    if (card) {
      const bar = card.querySelector('.preview-progress-bar');
      if (bar) bar.style.backgroundColor = 'var(--color-primary)';
      const retryBtn = card.querySelector('.preview-retry-btn');
      if (retryBtn) retryBtn.style.display = 'none';
      const errorSpan = card.querySelector('.preview-error-msg');
      if (errorSpan) {
        errorSpan.style.display = 'none';
        errorSpan.innerText = '';
      }
      const progressContainer = card.querySelector('.preview-progress-container');
      if (progressContainer) progressContainer.style.display = 'block';
    }

    this.startUpload(attachment);
  }

  removeAttachment(attachment) {
    if (attachment.xhr) {
      attachment.xhr.abort();
    }

    if (attachment.id) {
      fetch(`/api/attachments/${attachment.id}`, { method: 'DELETE' }).catch(err => console.error(err));
    }

    this.attachments = this.attachments.filter(a => a.clientUuid !== attachment.clientUuid);
    const card = document.getElementById(`preview-${attachment.clientUuid}`);
    if (card) card.remove();
  }

  clearAll() {
    this.attachments.forEach(attachment => {
      if (attachment.xhr) {
        attachment.xhr.abort();
      }
      if (attachment.id) {
        fetch(`/api/attachments/${attachment.id}`, { method: 'DELETE' }).catch(err => console.error(err));
      }
    });
    this.attachments = [];
    if (this.previewList) this.previewList.innerHTML = '';
  }

  isUploading() {
    return this.attachments.some(a => a.state === 'uploading');
  }

  getUploadedIds() {
    return this.attachments.filter(a => a.state === 'success').map(a => a.id);
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

// --- User Management Helper Functions ---
function openUserModal(user = null) {
  if (!elements.userModal) return;
  
  elements.formUser.reset();
  elements.userPasswordComplexity.style.display = 'none';
  elements.userPasswordField.required = !user; // password required only for new users

  if (user) {
    elements.userModalTitle.innerText = 'Edit User';
    elements.userIdField.value = user.id;
    elements.userUsernameField.value = user.username;
    elements.userEmailField.value = user.email;
    elements.userRoleField.value = user.role;
    elements.userBrandField.value = user.brand || '';
    elements.userPasswordField.placeholder = 'Leave blank to keep current password';
  } else {
    elements.userModalTitle.innerText = 'Add New User';
    elements.userIdField.value = '';
    elements.userBrandField.value = '';
    elements.userPasswordField.placeholder = 'Minimum 10 characters';
  }

  elements.userModal.classList.add('active');
}

function closeUserModal() {
  if (elements.userModal) {
    elements.userModal.classList.remove('active');
    elements.formUser.reset();
    resetPasswordVisibility();
  }
}

function validateUserPasswordComplexity(password) {
  if (!password) {
    elements.userPasswordComplexity.style.display = 'none';
    return;
  }
  elements.userPasswordComplexity.style.display = 'block';

  const requirements = {
    'user-req-length': password.length >= 10,
    'user-req-uppercase': /[A-Z]/.test(password),
    'user-req-lowercase': /[a-z]/.test(password),
    'user-req-number': /\d/.test(password),
    'user-req-special': /[@$!%*?&]/.test(password)
  };

  let allMet = true;
  for (const [id, isMet] of Object.entries(requirements)) {
    const el = document.getElementById(id);
    if (el) {
      if (isMet) {
        el.classList.add('met');
        el.querySelector('.chk-icon').innerText = '✓';
        el.querySelector('.chk-icon').style.color = '#10b981';
      } else {
        el.classList.remove('met');
        el.querySelector('.chk-icon').innerText = '✕';
        el.querySelector('.chk-icon').style.color = '#ef4444';
        allMet = false;
      }
    }
  }
  
  const saveBtn = document.getElementById('btn-save-user');
  if (saveBtn) {
    saveBtn.disabled = !allMet;
  }
}

async function handleSaveUser() {
  const id = elements.userIdField.value;
  const username = elements.userUsernameField.value.trim();
  const email = elements.userEmailField.value.trim();
  const password = elements.userPasswordField.value;
  const role = elements.userRoleField.value;
  const brand = elements.userBrandField.value || null;

  const userData = { username, email, role, brand };
  if (password) {
    userData.password = password;
  }

  const saveBtn = document.getElementById('btn-save-user');
  saveBtn.disabled = true;
  saveBtn.innerText = 'Saving...';

  try {
    if (id) {
      // Edit
      await api.updateUser(id, userData);
      showToast('User details updated successfully', 'success');
    } else {
      // Create
      if (!password) {
        showToast('Password is required for new users', 'error');
        saveBtn.disabled = false;
        saveBtn.innerText = 'Save User';
        return;
      }
      await api.createUser({ ...userData, password });
      showToast('New user account provisioned', 'success');
    }
    closeUserModal();
    loadUsers();
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error saving user details', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerText = 'Save User';
  }
}

// --- User Management State ---
let _allUsers = [];
let _userPage = 1;
const USERS_PER_PAGE = 5;

async function loadUsers(searchTerm = '') {
  if (!elements.usersTableBody) return;

  // Persist the current search term for reloads after delete/save
  const input = document.getElementById('user-search-input');
  if (input && !searchTerm && input.value.trim()) {
    searchTerm = input.value.trim();
  }

  elements.usersTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--text-muted);">Loading users list...</td></tr>';
  elements.usersEmptyState.style.display = 'none';

  try {
    const users = await api.getUsers();
    _allUsers = searchTerm
      ? users.filter(u =>
          u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.email.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : users;

    // Reset to page 1 when search changes
    _userPage = 1;
    renderUsersTable();
  } catch (err) {
    console.error(err);
    elements.usersTableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--priority-urgent);">Error loading users.</td></tr>';
  }
}

function renderUsersTable() {
  elements.usersTableBody.innerHTML = '';

  if (_allUsers.length === 0) {
    elements.usersEmptyState.style.display = 'flex';
    // Remove pagination if visible
    const existing = document.getElementById('users-pagination');
    if (existing) existing.remove();
    return;
  }

  elements.usersEmptyState.style.display = 'none';

  const totalPages = Math.ceil(_allUsers.length / USERS_PER_PAGE);
  _userPage = Math.min(_userPage, totalPages);
  const start = (_userPage - 1) * USERS_PER_PAGE;
  const pageUsers = _allUsers.slice(start, start + USERS_PER_PAGE);

  pageUsers.forEach(user => {
    const row = document.createElement('tr');
    const roleBadgeClass = user.role === 'Agent' ? 'role-agent' : 'role-customer';
    const isSelf = state.user && state.user.id === user.id;

    row.innerHTML = `
      <td>
        <div class="user-info-cell">
          <div class="avatar">${user.username.charAt(0).toUpperCase()}</div>
          <div class="user-details-text">
            <span class="user-name">${user.username} ${isSelf ? '<span style="font-size:0.75rem; color:var(--color-primary); font-weight:normal;">(You)</span>' : ''}</span>
            <span class="user-date">Registered ${formatDate(user.created_at)}</span>
          </div>
        </div>
      </td>
      <td><span style="font-size: 0.9rem; color: var(--text-secondary);">${user.email}</span></td>
      <td><span class="role-badge ${roleBadgeClass}">${user.role}</span></td>
      <td><span style="font-size: 0.9rem; color: var(--text-secondary);">${user.brand || '-'}</span></td>
      <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(user.created_at)}</td>
      <td style="text-align: right;">
        <button class="btn-action-icon btn-edit-user" title="Edit user" style="margin-right: 8px;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="btn-action-icon btn-delete" title="Delete user" ${isSelf ? 'disabled style="opacity: 0.35; cursor: not-allowed;"' : ''}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </td>
    `;

    row.querySelector('.btn-edit-user').addEventListener('click', (e) => {
      e.stopPropagation();
      openUserModal(user);
    });

    if (!isSelf) {
      const deleteBtn = row.querySelector('.btn-delete');
      let deleteConfirmPending = false;
      let deleteCancelTimer = null;

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (!deleteConfirmPending) {
          // First click: show confirm state
          deleteConfirmPending = true;
          deleteBtn.style.background = '#ef4444';
          deleteBtn.style.color = '#fff';
          deleteBtn.style.borderRadius = '6px';
          deleteBtn.title = 'Click again to confirm delete';
          deleteBtn.innerHTML = '<span style="font-size:0.7rem;font-weight:600;padding:0 4px;">Confirm?</span>';

          // Auto-cancel after 3 seconds
          deleteCancelTimer = setTimeout(() => {
            deleteConfirmPending = false;
            deleteBtn.style.background = '';
            deleteBtn.style.color = '';
            deleteBtn.style.borderRadius = '';
            deleteBtn.title = 'Delete user';
            deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>`;
          }, 3000);

        } else {
          // Second click: confirmed — execute delete
          clearTimeout(deleteCancelTimer);
          deleteConfirmPending = false;
          deleteBtn.disabled = true;
          deleteBtn.style.opacity = '0.4';
          deleteBtn.innerHTML = '<span style="font-size:0.7rem;padding:0 4px;">...</span>';

          try {
            await api.deleteUser(user.id);
            showToast(`"${user.username}" deleted successfully`, 'success');
            _allUsers = _allUsers.filter(u => u.id !== user.id);
            renderUsersTable();
          } catch (err) {
            console.error('Delete error:', err);
            showToast(err.message || 'Error deleting user', 'error');
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = '';
            deleteBtn.style.background = '';
            deleteBtn.style.color = '';
            deleteBtn.title = 'Delete user';
            deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>`;
          }
        }
      });
    }

    elements.usersTableBody.appendChild(row);
  });

  // Render pagination
  renderUsersPagination(totalPages);
}

function renderUsersPagination(totalPages) {
  // Remove old pagination
  const existing = document.getElementById('users-pagination');
  if (existing) existing.remove();

  if (totalPages <= 1) return;

  const wrapper = document.getElementById('users-table-wrapper');
  if (!wrapper) return;

  const nav = document.createElement('div');
  nav.id = 'users-pagination';
  nav.className = 'users-pagination';

  const info = document.createElement('span');
  info.className = 'pagination-info';
  const start = (_userPage - 1) * USERS_PER_PAGE + 1;
  const end = Math.min(_userPage * USERS_PER_PAGE, _allUsers.length);
  info.textContent = `${start}–${end} of ${_allUsers.length} users`;

  const controls = document.createElement('div');
  controls.className = 'pagination-controls';

  // Prev button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'pagination-btn';
  prevBtn.innerHTML = '&#8592; Prev';
  prevBtn.disabled = _userPage === 1;
  prevBtn.addEventListener('click', () => { _userPage--; renderUsersTable(); });

  // Page numbers
  const pageNums = document.createElement('div');
  pageNums.className = 'pagination-pages';
  const maxVisible = 5;
  let pStart = Math.max(1, _userPage - Math.floor(maxVisible / 2));
  let pEnd = Math.min(totalPages, pStart + maxVisible - 1);
  if (pEnd - pStart + 1 < maxVisible) pStart = Math.max(1, pEnd - maxVisible + 1);

  for (let p = pStart; p <= pEnd; p++) {
    const btn = document.createElement('button');
    btn.className = `pagination-page-btn${p === _userPage ? ' active' : ''}`;
    btn.textContent = p;
    btn.addEventListener('click', () => { _userPage = p; renderUsersTable(); });
    pageNums.appendChild(btn);
  }

  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'pagination-btn';
  nextBtn.innerHTML = 'Next &#8594;';
  nextBtn.disabled = _userPage === totalPages;
  nextBtn.addEventListener('click', () => { _userPage++; renderUsersTable(); });

  controls.appendChild(prevBtn);
  controls.appendChild(pageNums);
  controls.appendChild(nextBtn);

  nav.appendChild(info);
  nav.appendChild(controls);
  wrapper.appendChild(nav);
}

// --- Reports View Functions ---

let _reportTickets = [];

async function loadReportsData() {
  if (!elements.reportCustomer || !elements.reportAgent) return;

  // Clear previous results
  elements.reportTableBody.innerHTML = '';
  elements.reportResultsContainer.style.display = 'none';

  try {
    // 1. Fetch all users to populate filter dropdowns
    const users = await api.getUsers();
    
    // Populate customers select
    elements.reportCustomer.innerHTML = '<option value="">All Customers</option>';
    const customers = users.filter(u => u.role === 'Customer');
    customers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.email;
      opt.textContent = `${c.username} (${c.email})`;
      elements.reportCustomer.appendChild(opt);
    });

    // Populate agents select
    elements.reportAgent.innerHTML = '<option value="">All Agents</option>';
    const agents = users.filter(u => u.role === 'Agent');
    agents.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.username;
      opt.textContent = a.username;
      elements.reportAgent.appendChild(opt);
    });

  } catch (err) {
    console.error('Error loading reports filters:', err);
    showToast('Failed to load reports filters', 'error');
  }
}

async function handleGenerateReport() {
  const status = elements.reportStatus.value;
  const startDateVal = elements.reportStartDate.value;
  const endDateVal = elements.reportEndDate.value;
  const customerEmail = elements.reportCustomer.value;
  const agentName = elements.reportAgent.value;

  elements.reportTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--text-muted);">Generating report...</td></tr>';
  elements.reportEmptyState.style.display = 'none';
  elements.reportResultsContainer.style.display = 'block';

  try {
    // Fetch all tickets
    const tickets = await api.getTickets();

    // Filter tickets locally
    _reportTickets = tickets.filter(t => {
      // 1. Status check
      if (status && t.status !== status) return false;

      // 2. Date checks
      const ticketDate = new Date(t.created_at);
      if (startDateVal) {
        const start = new Date(startDateVal);
        start.setHours(0, 0, 0, 0);
        if (ticketDate < start) return false;
      }
      if (endDateVal) {
        const end = new Date(endDateVal);
        end.setHours(23, 59, 59, 999);
        if (ticketDate > end) return false;
      }

      // 3. Customer check
      if (customerEmail && t.customer_email !== customerEmail) return false;

      // 4. Agent check
      if (agentName) {
        if (!t.assignee_name || !t.assignee_name.toLowerCase().includes(agentName.toLowerCase())) {
          return false;
        }
      }

      return true;
    });

    renderReportTable();

  } catch (err) {
    console.error('Error generating report:', err);
    showToast('Failed to generate report', 'error');
    elements.reportTableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--priority-urgent);">Error loading reports.</td></tr>';
  }
}

function renderReportTable() {
  elements.reportTableBody.innerHTML = '';

  if (_reportTickets.length === 0) {
    elements.reportEmptyState.style.display = 'flex';
    return;
  }

  elements.reportEmptyState.style.display = 'none';

  _reportTickets.forEach(t => {
    const row = document.createElement('tr');
    
    let statusClass = 'status-new';
    if (t.status === 'Open') statusClass = 'status-open';
    else if (t.status === 'Pending') statusClass = 'status-pending';
    else if (t.status === 'Solved') statusClass = 'status-solved';
    else if (t.status === 'Closed') statusClass = 'status-closed';

    let priorityClass = 'priority-low';
    if (t.priority === 'Medium') priorityClass = 'priority-medium';
    else if (t.priority === 'High') priorityClass = 'priority-high';
    else if (t.priority === 'Urgent') priorityClass = 'priority-urgent';

    row.innerHTML = `
      <td style="font-weight: 600; color: var(--color-primary);">#${t.id}</td>
      <td>
        <span class="ticket-subject" style="font-weight: 500; color: var(--text-primary);">${t.title}</span>
      </td>
      <td><span class="status-badge ${statusClass}">${t.status}</span></td>
      <td><span class="priority-tag ${priorityClass}">${t.priority}</span></td>
      <td>
        <div style="display: flex; flex-direction: column;">
          <span style="font-weight: 500; color: var(--text-primary);">${t.customer_name}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${t.customer_email}</span>
        </div>
      </td>
      <td><span style="font-size: 0.9rem; color: var(--text-secondary);">${t.assignee_name || 'Unassigned'}</span></td>
      <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(t.created_at)}</td>
    `;
    elements.reportTableBody.appendChild(row);
  });
}

function handleResetReportFilters() {
  elements.reportStatus.value = '';
  elements.reportStartDate.value = '';
  elements.reportEndDate.value = '';
  elements.reportCustomer.value = '';
  elements.reportAgent.value = '';
  elements.reportTableBody.innerHTML = '';
  elements.reportResultsContainer.style.display = 'none';
  elements.reportEmptyState.style.display = 'none';
}

function exportReportToExcel() {
  if (_reportTickets.length === 0) return;
  
  let csvContent = '\uFEFF';
  csvContent += 'Ticket ID,Subject,Status,Priority,Customer Name,Customer Email,Assignee,Created At\n';
  
  _reportTickets.forEach(t => {
    const id = `#${t.id}`;
    const subject = `"${t.title.replace(/"/g, '""')}"`;
    const status = `"${t.status}"`;
    const priority = `"${t.priority}"`;
    const customerName = `"${t.customer_name.replace(/"/g, '""')}"`;
    const customerEmail = `"${t.customer_email.replace(/"/g, '""')}"`;
    const assignee = `"${(t.assignee_name || 'Unassigned').replace(/"/g, '""')}"`;
    const createdAt = `"${formatDate(t.created_at)}"`;

    csvContent += [id, subject, status, priority, customerName, customerEmail, assignee, createdAt].join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', `Ticketing_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportReportToPDF() {
  if (_reportTickets.length === 0) return;

  const printWindow = window.open('', '_blank');
  
  const statusStr = elements.reportStatus.value || 'All Statuses';
  const startStr = elements.reportStartDate.value || 'Any';
  const endStr = elements.reportEndDate.value || 'Any';
  const customerStr = elements.reportCustomer.options[elements.reportCustomer.selectedIndex]?.text || 'All Customers';
  const agentStr = elements.reportAgent.options[elements.reportAgent.selectedIndex]?.text || 'All Agents';

  printWindow.document.write(`
    <html>
      <head>
        <title>OmniDesk Ticketing Report</title>
        <style>
          body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 30px; color: #0f172a; line-height: 1.5; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 24px; }
          .title { font-size: 24px; font-weight: 700; color: #4f46e5; margin: 0; }
          .meta { font-size: 13px; color: #64748b; margin-top: 4px; }
          .filters-summary { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 13px; }
          .filters-summary h3 { margin-top: 0; margin-bottom: 8px; font-size: 14px; color: #334155; }
          .filters-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th { background: #f1f5f9; color: #475569; font-weight: 600; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #cbd5e1; }
          th, td { padding: 12px 14px; font-size: 13px; border-bottom: 1px solid #e2e8f0; }
          tr:hover { background-color: #f8fafc; }
          .status-badge { display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 9999px; text-transform: uppercase; }
          .status-new { background-color: #dbeafe; color: #1e40af; }
          .status-open { background-color: #fee2e2; color: #991b1b; }
          .status-pending { background-color: #fef3c7; color: #92400e; }
          .status-solved { background-color: #d1fae5; color: #065f46; }
          .status-closed { background-color: #f1f5f9; color: #374151; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 class="title">OmniDesk Ticketing Report</h1>
            <div class="meta">Generated on ${new Date().toLocaleString()} by ${state.user ? state.user.username : 'Agent'}</div>
          </div>
        </div>
        
        <div class="filters-summary">
          <h3>Report Filters Applied:</h3>
          <div class="filters-grid">
            <div><strong>Status:</strong> ${statusStr}</div>
            <div><strong>Date Range:</strong> ${startStr} to ${endStr}</div>
            <div><strong>Customer:</strong> ${customerStr}</div>
            <div><strong>Agent:</strong> ${agentStr}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Customer</th>
              <th>Assignee</th>
              <th>Created At</th>
            </tr>
          </thead>
          <tbody>
            ${_reportTickets.map(t => {
              let statusClass = 'status-new';
              if (t.status === 'Open') statusClass = 'status-open';
              else if (t.status === 'Pending') statusClass = 'status-pending';
              else if (t.status === 'Solved') statusClass = 'status-solved';
              else if (t.status === 'Closed') statusClass = 'status-closed';

              return `
                <tr>
                  <td style="font-weight: 600; color: #4f46e5;">#${t.id}</td>
                  <td style="font-weight: 500;">${t.title}</td>
                  <td><span class="status-badge ${statusClass}">${t.status}</span></td>
                  <td>${t.priority}</td>
                  <td>${t.customer_name}<br><span style="font-size: 11px; color: #64748b;">${t.customer_email}</span></td>
                  <td>${t.assignee_name || 'Unassigned'}</td>
                  <td>${new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              window.close();
            }, 250);
          }
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// Bind Reports event listeners
if (elements.btnGenerateReport) {
  elements.btnGenerateReport.addEventListener('click', handleGenerateReport);
}
if (elements.btnResetReportFilters) {
  elements.btnResetReportFilters.addEventListener('click', handleResetReportFilters);
}
if (elements.btnExportPDF) {
  elements.btnExportPDF.addEventListener('click', exportReportToPDF);
}
if (elements.btnExportExcel) {
  elements.btnExportExcel.addEventListener('click', exportReportToExcel);
}

