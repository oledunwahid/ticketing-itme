/* ==========================================================================
   OmniDesk - Frontend Logic Script
   ========================================================================== */

// --- Global Application State ---
const state = {
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
  themeToggle: document.getElementById('theme-toggle')
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
document.addEventListener('DOMContentLoaded', () => {
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
  loadAllData();
});

// --- API Helper Functions ---
const api = {
  baseUrl: '/api',

  async getStats() {
    const res = await fetch(`${this.baseUrl}/stats`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  async getTickets(filters = {}) {
    const query = new URLSearchParams();
    if (filters.status) query.append('status', filters.status);
    if (filters.priority) query.append('priority', filters.priority);
    if (filters.search) query.append('search', filters.search);
    
    const res = await fetch(`${this.baseUrl}/tickets?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch tickets');
    return res.json();
  },

  async getTicketDetails(id) {
    const res = await fetch(`${this.baseUrl}/tickets/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch ticket details for ID ${id}`);
    return res.json();
  },

  async createTicket(ticketData) {
    const res = await fetch(`${this.baseUrl}/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ticketData)
    });
    if (!res.ok) throw new Error('Failed to create ticket');
    return res.json();
  },

  async updateTicket(id, updateData) {
    const res = await fetch(`${this.baseUrl}/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });
    if (!res.ok) throw new Error('Failed to update ticket');
    return res.json();
  },

  async addComment(id, commentData) {
    const res = await fetch(`${this.baseUrl}/tickets/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commentData)
    });
    if (!res.ok) throw new Error('Failed to add comment');
    return res.json();
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
}

// --- Navigation Controller ---
function switchView(targetId) {
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
  } else if (targetId === 'section-dashboard') {
    loadStats();
    loadUrgentTickets();
  }
}

// --- Data Fetching Operations ---
async function loadAllData() {
  try {
    await Promise.all([
      loadStats(),
      loadUrgentTickets(),
      loadTickets()
    ]);
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
