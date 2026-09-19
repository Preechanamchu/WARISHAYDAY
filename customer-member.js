/**
 * WARISHAYDAY - Customer Member Portal Controller
 * Game Store Premium + Hay Day Farm Style
 */

(function () {
    'use strict';

    // State
    let memberData = null;
    let activeTag = null;
    let memberOrders = [];
    let memberTransactions = [];
    let currentOrdersFilterTime = 'all';
    let currentOrdersFilterStatus = 'ALL';

    // Helper: Format THB Currency
    function formatCurrency(amount) {
        const num = Number(amount) || 0;
        return '฿' + num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Helper: Format Date
    function formatDate(dateStr) {
        if (!dateStr) return '-';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleString('th-TH', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return dateStr;
        }
    }

    // Helper: Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Helper: Fetch with Member Auth
    async function memberFetch(url, options = {}) {
        const token = localStorage.getItem('member_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return fetch(url, { ...options, headers });
    }

    // Check if Member is Logged In
    function isMemberLoggedIn() {
        return localStorage.getItem('isMemberLoggedIn') === 'true' && !!localStorage.getItem('member_token');
    }

    // 1. Initialize Member Portal
    async function initMemberPortal() {
        if (!isMemberLoggedIn()) {
            updateMemberVisibilityUI(false);
            return;
        }

        try {
            const res = await memberFetch('/api/member/profile');
            if (res.status === 401 || res.status === 403) {
                // Token expired or member suspended
                memberLogout(false);
                return;
            }

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to load profile');

            memberData = data;
            if (data.tags && data.tags.length > 0) {
                activeTag = data.tags[0].tag;
            }

            updateMemberVisibilityUI(true);
            renderMemberHeader();
            renderMemberDashboard();

        } catch (err) {
            console.error('initMemberPortal error:', err);
        }
    }

    // Update UI Visibility for Member vs Guest
    function updateMemberVisibilityUI(isLoggedIn) {
        const guestBar = document.getElementById('customer-guest-bar');
        const memberBar = document.getElementById('customer-member-bar');
        const storefrontBanner = document.getElementById('storefront-member-banner');

        if (isLoggedIn && memberData) {
            if (guestBar) guestBar.style.display = 'none';
            if (memberBar) memberBar.style.display = 'flex';
            if (storefrontBanner) storefrontBanner.style.display = 'flex';

            // Populate Member Bar
            const nameEl = document.getElementById('cust-bar-name');
            const userEl = document.getElementById('cust-bar-username');
            const balEl = document.getElementById('cust-bar-balance');
            const tagSelect = document.getElementById('cust-bar-tag-select');
            const smbName = document.getElementById('smb-member-name');
            const smbCredit = document.getElementById('smb-credit-val');
            const smbTagSelect = document.getElementById('smb-tag-select');

            const displayName = (memberData.firstName && memberData.lastName)
                ? `${memberData.firstName} ${memberData.lastName}`
                : (memberData.firstName || memberData.username);

            if (nameEl) nameEl.textContent = displayName;
            if (userEl) userEl.textContent = `@${memberData.username}`;
            if (balEl) balEl.textContent = formatCurrency(memberData.wallet?.balance || 0);

            if (smbName) smbName.textContent = displayName;
            if (smbCredit) smbCredit.textContent = formatCurrency(memberData.wallet?.balance || 0);

            // Populate tag selectors
            const tags = memberData.tags || [];
            const tagOptions = tags.map(t => 
                `<option value="${escapeHtml(t.tag)}" ${t.tag === activeTag ? 'selected' : ''}>#${escapeHtml(t.tag)}${t.tagName ? ` (${escapeHtml(t.tagName)})` : ''}</option>`
            ).join('');

            if (tagSelect) {
                tagSelect.innerHTML = tags.length ? tagOptions : '<option value="">ยังไม่มีแท็ก</option>';
            }
            if (smbTagSelect) {
                smbTagSelect.innerHTML = tags.length ? tagOptions : '<option value="">-- ยังไม่มีแท็ก --</option>';
            }

        } else {
            if (guestBar) guestBar.style.display = 'flex';
            if (memberBar) memberBar.style.display = 'none';
            if (storefrontBanner) storefrontBanner.style.display = 'none';
        }
    }

    // Render Member Header
    function renderMemberHeader() {
        if (!memberData) return;
        const balanceEl = document.getElementById('member-header-balance');
        const nameEl = document.getElementById('member-header-name');

        const displayName = (memberData.firstName && memberData.lastName)
            ? `${memberData.firstName} ${memberData.lastName}`
            : (memberData.firstName || memberData.username);

        if (balanceEl) balanceEl.textContent = formatCurrency(memberData.wallet?.balance || 0);
        if (nameEl) nameEl.textContent = displayName;
    }

    // Render Member Dashboard Subpage
    async function renderMemberDashboard() {
        if (!memberData) return;

        // Greeting
        const dashName = document.getElementById('member-dash-name');
        const dashId = document.getElementById('member-dash-id');
        const dashBalance = document.getElementById('member-dash-balance');

        const displayName = (memberData.firstName && memberData.lastName)
            ? `${memberData.firstName} ${memberData.lastName}`
            : (memberData.firstName || memberData.username);

        if (dashName) dashName.textContent = displayName;
        if (dashId) dashId.textContent = memberData.memberCode || `#${String(memberData.id).padStart(6, '0')}`;
        if (dashBalance) {
            const bal = Number(memberData.wallet?.balance || 0);
            dashBalance.textContent = bal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // Summary 4 Stats
        const statCredit = document.getElementById('stat-dash-credit');
        const statOrders = document.getElementById('stat-dash-orders');
        const statTags = document.getElementById('stat-dash-tags');
        const statDeposit = document.getElementById('stat-dash-total-deposit');

        if (statCredit) statCredit.textContent = formatCurrency(memberData.wallet?.balance || 0);
        if (statOrders) statOrders.textContent = (memberData.orderCount || 0).toLocaleString();
        if (statTags) statTags.textContent = (memberData.tags?.length || 0);
        if (statDeposit) statDeposit.textContent = formatCurrency(memberData.wallet?.totalDeposited || 0);

        // Tags List Widget
        renderDashboardTagsList();

        // Recent Orders Widget
        loadRecentOrdersWidget();
    }

    // Render Dashboard Tags Widget
    function renderDashboardTagsList() {
        const container = document.getElementById('member-dash-tags-list');
        const counter = document.getElementById('member-dash-tag-counter');
        if (!container) return;

        const tags = memberData?.tags || [];
        if (counter) counter.textContent = `${tags.length} / 10 Tags`;

        if (tags.length === 0) {
            container.innerHTML = `
                <div style="color: #64748b; font-size: 0.9rem; padding: 10px 0;">
                    ยังไม่มีแท็กรับสินค้า <button type="button" class="btn btn-small btn-primary" onclick="openMemberAddTagModal()" style="margin-left: 8px;">+ เพิ่มแท็กแรกของคุณ</button>
                </div>
            `;
            return;
        }

        container.innerHTML = tags.map(t => {
            const isActive = t.tag === activeTag;
            return `
                <div class="dash-tag-chip ${isActive ? 'active-tag' : ''}" onclick="selectActiveTag('${escapeHtml(t.tag)}')">
                    <span class="chip-hash">#</span>
                    <span class="chip-code">${escapeHtml(t.tag)}</span>
                    ${t.tagName ? `<span class="chip-name">(${escapeHtml(t.tagName)})</span>` : ''}
                    ${isActive ? '<span class="chip-active-badge">✓ ใช้งานอยู่</span>' : ''}
                </div>
            `;
        }).join('');
    }

    // Set Active Tag for Ordering
    function selectActiveTag(tag) {
        activeTag = tag;
        renderDashboardTagsList();
        updateMemberVisibilityUI(true);

        // Sync order modal input if open
        const orderTagInput = document.getElementById('order-tag-input');
        if (orderTagInput) {
            orderTagInput.value = tag;
        }

        if (typeof Notify !== 'undefined' && Notify.info) {
            Notify.info('เปลี่ยนแท็กใช้งาน', `เลือกแท็ก #${tag} สำหรับสั่งซื้อสินค้า`);
        }
    }

    // Load Recent Orders Widget on Dashboard
    async function loadRecentOrdersWidget() {
        const container = document.getElementById('member-dash-recent-orders');
        if (!container) return;

        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #94a3b8;">⏳ กำลังโหลดคำสั่งซื้อ...</div>';

        try {
            const res = await memberFetch('/api/member/orders?limit=5');
            if (!res.ok) throw new Error('Failed to load orders');
            const data = await res.json();
            const orders = data.orders || [];

            if (orders.length === 0) {
                container.innerHTML = `
                    <div class="member-empty-state" style="padding: 24px 10px;">
                        <div class="empty-icon">📦</div>
                        <h4 style="margin: 6px 0;">ยังไม่มีประวัติคำสั่งซื้อ</h4>
                        <p style="color: #64748b; font-size: 0.85rem; margin: 0 0 12px;">เริ่มสั่งซื้อสินค้า Hay Day วันนี้ด้วยเครดิตของคุณ</p>
                        <button type="button" class="btn btn-primary btn-small" onclick="switchMemberSubpage('shop')">🛒 สั่งสินค้าเลย</button>
                    </div>
                `;
                return;
            }

            container.innerHTML = orders.map(ord => renderOrderCardHtml(ord, true)).join('');

        } catch (err) {
            console.error('loadRecentOrdersWidget error:', err);
            container.innerHTML = '<div style="color: #ef4444; padding: 14px; text-align: center;">ไม่สามารถโหลดข้อมูลคำสั่งซื้อได้</div>';
        }
    }

    // Render Order Card HTML
    function renderOrderCardHtml(ord, isCompact = false) {
        const statusClassMap = {
            'PENDING': 'badge-reg-pending',
            'PROCESSING': 'badge-reg-active',
            'COMPLETED': 'badge-reg-active',
            'CANCELLED': 'badge-reg-rejected'
        };
        const statusLabelMap = {
            'PENDING': '⏳ รอดำเนินการ',
            'PROCESSING': '⚙️ กำลังดำเนินการ',
            'COMPLETED': '✅ สำเร็จ',
            'CANCELLED': '❌ ยกเลิก'
        };

        const statusClass = statusClassMap[ord.status] || 'badge-reg-pending';
        const statusLabel = statusLabelMap[ord.status] || ord.status;

        // Parse items
        let itemsCount = 0;
        let itemsSummary = '';
        if (typeof ord.items === 'object' && ord.items !== null) {
            const keys = Object.keys(ord.items);
            itemsCount = keys.length;
            itemsSummary = `${itemsCount} รายการ`;
        }

        return `
            <div class="member-order-card" onclick="viewOrderDetail('${escapeHtml(ord.orderNumber || ord.id)}')">
                <div class="moc-header">
                    <div class="moc-id-group">
                        <span class="moc-id">#${escapeHtml(ord.orderNumber || ord.id)}</span>
                        <span class="moc-date">${formatDate(ord.createdAt)}</span>
                    </div>
                    <span class="badge-reg-status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="moc-body">
                    <div class="moc-info-row">
                        <span class="moc-lbl">แท็กฟาร์ม:</span>
                        <strong class="moc-val tag-val">#${escapeHtml(ord.customerTag || '-')}</strong>
                    </div>
                    <div class="moc-info-row">
                        <span class="moc-lbl">การชำระเงิน:</span>
                        <span class="moc-val">${ord.paymentMethod === 'CREDIT' ? '💰 เครดิตสมาชิก' : 'โอนเงิน'}</span>
                    </div>
                    <div class="moc-info-row">
                        <span class="moc-lbl">ยอดรวม:</span>
                        <strong class="moc-val moc-price">${formatCurrency(ord.totalAmount || ord.total)}</strong>
                    </div>
                </div>
                <div class="moc-footer">
                    <span class="moc-items-count">📦 ${itemsSummary || 'ดูรายการสินค้า'}</span>
                    <span class="moc-view-detail">ดูรายละเอียด »</span>
                </div>
            </div>
        `;
    }

    // 2. Switch Member Sub-page
    function switchMemberSubpage(pageName) {
        if (pageName === 'shop') {
            // Switch to storefront view with active member banner!
            if (typeof window.switchView === 'function') {
                window.switchView('customer');
            } else {
                const custView = document.getElementById('customer-view');
                const memView = document.getElementById('customer-member-view');
                if (custView) custView.classList.add('active');
                if (memView) memView.classList.remove('active');
            }
            updateMemberVisibilityUI(true);

            // Pre-fill active tag
            const orderTagInput = document.getElementById('order-tag-input');
            if (orderTagInput && activeTag) {
                orderTagInput.value = activeTag;
            }
            return;
        }

        // Switch to member view if not already there
        if (typeof window.switchView === 'function') {
            window.switchView('customerMember');
        } else {
            const custView = document.getElementById('customer-view');
            const memView = document.getElementById('customer-member-view');
            if (custView) custView.classList.remove('active');
            if (memView) memView.classList.add('active');
        }

        // Hide all subpages
        document.querySelectorAll('.member-subpage').forEach(el => el.classList.remove('active'));

        // Show target subpage
        const target = document.getElementById(`member-subpage-${pageName}`);
        if (target) {
            target.classList.add('active');
        }

        // Update Desktop Navigation Active state
        document.querySelectorAll('.member-desktop-nav .member-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });

        // Update Mobile Bottom Navigation Active state
        document.querySelectorAll('#customer-bottom-nav .bottom-nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });

        // Subpage specific loads
        if (pageName === 'dashboard') {
            renderMemberDashboard();
        } else if (pageName === 'orders') {
            loadMemberOrders();
        } else if (pageName === 'credit') {
            loadMemberCredit();
        } else if (pageName === 'tags') {
            loadMemberTags();
        } else if (pageName === 'profile') {
            loadMemberProfile();
        }

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // 3. Load Member Orders Subpage
    async function loadMemberOrders() {
        const container = document.getElementById('member-all-orders-list');
        if (!container) return;

        container.innerHTML = '<div style="text-align: center; padding: 40px; color: #94a3b8;">⏳ กำลังโหลดคำสั่งซื้อทั้งหมด...</div>';

        try {
            const params = new URLSearchParams();
            if (currentOrdersFilterStatus !== 'ALL') {
                params.append('status', currentOrdersFilterStatus);
            }
            if (currentOrdersFilterTime !== 'all') {
                params.append('timeframe', currentOrdersFilterTime);
            }

            const res = await memberFetch(`/api/member/orders?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to load orders');
            const data = await res.json();
            memberOrders = data.orders || [];

            if (memberOrders.length === 0) {
                container.innerHTML = `
                    <div class="member-empty-state" style="padding: 40px 10px;">
                        <div class="empty-icon">📦</div>
                        <h3>ไม่พบคำสั่งซื้อ</h3>
                        <p>ไม่มีรายการคำสั่งซื้อตรงตามเงื่อนไขที่คุณเลือก</p>
                        <button type="button" class="btn btn-primary" onclick="switchMemberSubpage('shop')" style="margin-top: 12px;">🛒 สั่งซื้อสินค้า</button>
                    </div>
                `;
                return;
            }

            container.innerHTML = memberOrders.map(ord => renderOrderCardHtml(ord, false)).join('');

        } catch (err) {
            console.error('loadMemberOrders error:', err);
            container.innerHTML = '<div style="color: #ef4444; padding: 20px; text-align: center;">ไม่สามารถโหลดข้อมูลคำสั่งซื้อได้</div>';
        }
    }

    // 4. View Order Detail Modal
    async function viewOrderDetail(orderNumber) {
        const modal = document.getElementById('member-order-detail-modal');
        if (!modal) return;

        // Reset fields
        document.getElementById('mod-ord-id').textContent = `Order ID: #${orderNumber}`;
        document.getElementById('mod-ord-date').textContent = 'กำลังโหลด...';
        document.getElementById('mod-ord-tag').textContent = '-';
        document.getElementById('mod-ord-payment').textContent = '-';
        document.getElementById('mod-ord-status').textContent = '-';
        document.getElementById('mod-ord-items-list').innerHTML = 'กำลังโหลด...';
        document.getElementById('mod-ord-total').textContent = '฿0.00';
        document.getElementById('mod-ord-credit-breakdown').style.display = 'none';

        modal.style.display = 'flex';

        try {
            const res = await memberFetch(`/api/member/orders?orderNumber=${encodeURIComponent(orderNumber)}`);
            if (!res.ok) throw new Error('Failed to load order detail');
            const data = await res.json();
            const ord = data.order;
            if (!ord) throw new Error('Order not found');

            document.getElementById('mod-ord-date').textContent = formatDate(ord.createdAt);
            document.getElementById('mod-ord-tag').textContent = `#${ord.customerTag || '-'}`;
            document.getElementById('mod-ord-payment').textContent = ord.paymentMethod === 'CREDIT' ? '💰 เครดิตสมาชิก' : 'โอนเงิน';

            const statusEl = document.getElementById('mod-ord-status');
            statusEl.textContent = ord.status;
            statusEl.className = `badge-reg-status ${ord.status === 'COMPLETED' ? 'badge-reg-active' : ord.status === 'CANCELLED' ? 'badge-reg-rejected' : 'badge-reg-pending'}`;

            document.getElementById('mod-ord-total').textContent = formatCurrency(ord.totalAmount || ord.total);

            // Render Items
            const itemsContainer = document.getElementById('mod-ord-items-list');
            let itemsHtml = '';
            if (typeof ord.items === 'object' && ord.items !== null) {
                for (const [prodId, qty] of Object.entries(ord.items)) {
                    itemsHtml += `
                        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #f1f5f9; font-size: 0.88rem;">
                            <span>${escapeHtml(prodId)}</span>
                            <strong>x ${qty}</strong>
                        </div>
                    `;
                }
            }
            itemsContainer.innerHTML = itemsHtml || '<div style="color: #94a3b8; font-size: 0.85rem;">ไม่มีข้อมูลรายการ</div>';

            // Credit Breakdown (if paid by credit)
            if (ord.paymentMethod === 'CREDIT' && ord.creditTransaction) {
                const cb = document.getElementById('mod-ord-credit-breakdown');
                cb.style.display = 'block';
                document.getElementById('mod-ord-credit-before').textContent = formatCurrency(ord.creditTransaction.balanceBefore);
                document.getElementById('mod-ord-credit-deducted').textContent = `-${formatCurrency(ord.creditTransaction.amount)}`;
                document.getElementById('mod-ord-credit-after').textContent = formatCurrency(ord.creditTransaction.balanceAfter);
            }

        } catch (err) {
            console.error('viewOrderDetail error:', err);
            document.getElementById('mod-ord-items-list').innerHTML = `<div style="color: #ef4444;">${err.message}</div>`;
        }
    }

    // 5. Load Member Credit & Wallet Subpage
    async function loadMemberCredit() {
        const balEl = document.getElementById('credit-page-balance');
        const depEl = document.getElementById('credit-page-total-deposit');
        const spentEl = document.getElementById('credit-page-total-spent');
        const listEl = document.getElementById('member-tx-ledger-list');

        if (memberData && memberData.wallet) {
            if (balEl) balEl.textContent = formatCurrency(memberData.wallet.balance);
            if (depEl) depEl.textContent = formatCurrency(memberData.wallet.totalDeposited);
            if (spentEl) spentEl.textContent = formatCurrency(memberData.wallet.totalSpent);
        }

        if (!listEl) return;
        listEl.innerHTML = '<div style="text-align: center; padding: 30px; color: #94a3b8;">⏳ กำลังโหลดประวัติรายการ...</div>';

        try {
            const res = await memberFetch('/api/member/transactions');
            if (!res.ok) throw new Error('Failed to load transactions');
            const data = await res.json();
            memberTransactions = data.transactions || [];

            if (memberTransactions.length === 0) {
                listEl.innerHTML = `
                    <div class="member-empty-state" style="padding: 30px 10px;">
                        <div class="empty-icon">📜</div>
                        <h4>ยังไม่มีประวัติรายการ</h4>
                        <p style="color: #64748b; font-size: 0.85rem;">เมื่อคุณเติมเครดิตหรือสั่งซื้อสินค้า รายการจะบันทึกที่นี่</p>
                    </div>
                `;
                return;
            }

            listEl.innerHTML = memberTransactions.map(tx => {
                const isPositive = Number(tx.amount) > 0;
                const sign = isPositive ? '+' : '';
                const colorClass = isPositive ? 'tx-amount-green' : 'tx-amount-red';

                const typeLabelMap = {
                    'DEPOSIT': '💰 เติมเครดิต',
                    'ORDER_PAYMENT': '🛒 สั่งซื้อสินค้า',
                    'ADMIN_ADJUST': '⚙️ ปรับเครดิตโดยแอดมิน',
                    'REFUND': '↩️ คืนเงิน'
                };
                const typeLabel = typeLabelMap[tx.type] || tx.type;

                return `
                    <div class="tx-ledger-item">
                        <div class="tx-left">
                            <div class="tx-icon-box ${isPositive ? 'tx-icon-dep' : 'tx-icon-spent'}">
                                ${isPositive ? '➕' : '🛒'}
                            </div>
                            <div class="tx-info">
                                <div class="tx-title">${escapeHtml(typeLabel)}</div>
                                <div class="tx-date">${formatDate(tx.createdAt)} ${tx.referenceId ? `• Ref: ${escapeHtml(tx.referenceId)}` : ''}</div>
                                ${tx.notes ? `<div class="tx-notes">${escapeHtml(tx.notes)}</div>` : ''}
                            </div>
                        </div>
                        <div class="tx-right">
                            <div class="tx-amount ${colorClass}">${sign}${formatCurrency(tx.amount)}</div>
                            <div class="tx-balance-after">คงเหลือ: ${formatCurrency(tx.balanceAfter)}</div>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (err) {
            console.error('loadMemberCredit error:', err);
            listEl.innerHTML = '<div style="color: #ef4444; padding: 14px; text-align: center;">ไม่สามารถโหลดประวัติรายการได้</div>';
        }
    }

    // 6. Load Member Tags Subpage
    async function loadMemberTags() {
        const grid = document.getElementById('member-tags-page-grid');
        if (!grid) return;

        grid.innerHTML = '<div style="text-align: center; padding: 40px; color: #94a3b8; grid-column: 1 / -1;">⏳ กำลังโหลดแท็กฟาร์ม...</div>';

        try {
            const res = await memberFetch('/api/member/tags');
            if (!res.ok) throw new Error('Failed to load tags');
            const data = await res.json();
            const tags = data.tags || [];

            if (memberData) {
                memberData.tags = tags;
            }

            if (tags.length === 0) {
                grid.innerHTML = `
                    <div class="member-empty-state" style="grid-column: 1 / -1; padding: 40px 10px;">
                        <div class="empty-icon">🏷️</div>
                        <h3>ยังไม่มีแท็กรับสินค้า</h3>
                        <p>เพิ่มแท็กฟาร์ม Hay Day เพื่อความสะดวกในการสั่งซื้อสินค้า</p>
                        <button type="button" class="btn btn-primary" onclick="openMemberAddTagModal()" style="margin-top: 12px;">+ เพิ่มแท็กรับสินค้า</button>
                    </div>
                `;
                return;
            }

            grid.innerHTML = tags.map(t => {
                const isActive = t.tag === activeTag;
                return `
                    <div class="member-tag-card ${isActive ? 'card-active-tag' : ''}">
                        <div class="mtc-top">
                            <span class="mtc-hash">🌾 แท็กฟาร์ม</span>
                            ${isActive ? '<span class="badge-tag-active">✓ ใช้งานอยู่</span>' : ''}
                        </div>
                        <div class="mtc-tag-code">#${escapeHtml(t.tag)}</div>
                        ${t.tagName ? `<div class="mtc-tag-name">${escapeHtml(t.tagName)}</div>` : '<div class="mtc-tag-name" style="color:#94a3b8;">(ไม่ได้ระบุชื่อฟาร์ม)</div>'}
                        <div class="mtc-actions">
                            <button type="button" class="btn-mtc-copy" onclick="copyTextToClipboard('${escapeHtml(t.tag)}')">📋 คัดลอก</button>
                            ${!isActive ? `<button type="button" class="btn-mtc-use" onclick="selectActiveTag('${escapeHtml(t.tag)}')">🌾 ใช้แท็กนี้</button>` : ''}
                            <button type="button" class="btn-mtc-del" onclick="deleteMemberTag(${t.id}, '${escapeHtml(t.tag)}')">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (err) {
            console.error('loadMemberTags error:', err);
            grid.innerHTML = '<div style="color: #ef4444; padding: 20px; text-align: center; grid-column: 1 / -1;">ไม่สามารถโหลดข้อมูลแท็กได้</div>';
        }
    }

    // Delete Member Tag
    async function deleteMemberTag(tagId, tagCode) {
        if (!confirm(`คุณต้องการลบแท็ก #${tagCode} หรือไม่?`)) return;

        try {
            const res = await memberFetch(`/api/member/tags?id=${tagId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to delete tag');

            if (typeof Notify !== 'undefined' && Notify.success) {
                Notify.success('สำเร็จ', `ลบแท็ก #${tagCode} เรียบร้อยแล้ว`);
            }

            // Refresh tags
            await loadMemberTags();
            renderDashboardTagsList();
            updateMemberVisibilityUI(true);

        } catch (err) {
            console.error('deleteMemberTag error:', err);
            if (typeof Notify !== 'undefined' && Notify.error) {
                Notify.error('ข้อผิดพลาด', err.message);
            } else {
                alert(err.message);
            }
        }
    }

    // 7. Load Member Profile Subpage
    function loadMemberProfile() {
        if (!memberData) return;

        document.getElementById('prof-member-id').textContent = memberData.memberCode || `#${String(memberData.id).padStart(6, '0')}`;
        document.getElementById('prof-username').textContent = memberData.username || '-';

        const fullName = (memberData.firstName && memberData.lastName)
            ? `${memberData.firstName} ${memberData.lastName}`
            : (memberData.firstName || '-');
        document.getElementById('prof-fullname').textContent = fullName;
        document.getElementById('prof-phone').textContent = memberData.phone || '-';
        document.getElementById('prof-registered').textContent = formatDate(memberData.createdAt);
    }

    // 8. Modals Setup & Event Listeners
    function setupMemberModals() {
        // --- Top-up Modal ---
        const topupModal = document.getElementById('customer-topup-modal');
        const closeTopup = document.getElementById('close-customer-topup-modal');
        const topupForm = document.getElementById('customer-topup-form');
        const amountInput = document.getElementById('topup-amount-input');
        const slipFileInput = document.getElementById('topup-slip-file');
        const slipPreview = document.getElementById('topup-slip-preview');
        const slipPlaceholder = document.getElementById('topup-slip-placeholder');
        const topupErr = document.getElementById('topup-error-msg');
        const topupSucc = document.getElementById('topup-success-msg');
        const topupSubmitBtn = document.getElementById('btn-submit-topup');
        let currentSlipBase64 = '';

        if (closeTopup && topupModal) {
            closeTopup.onclick = () => { topupModal.style.display = 'none'; };
        }

        // Quick amount pills
        document.querySelectorAll('.amount-pill').forEach(pill => {
            pill.onclick = () => {
                document.querySelectorAll('.amount-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                if (amountInput) {
                    amountInput.value = pill.dataset.amount;
                }
            };
        });

        // Slip File Upload
        if (slipFileInput) {
            slipFileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                if (file.size > 5 * 1024 * 1024) {
                    alert('ขนาดไฟล์ต้องไม่เกิน 5 MB');
                    return;
                }

                const reader = new FileReader();
                reader.onload = (event) => {
                    currentSlipBase64 = event.target.result;
                    if (slipPreview) {
                        slipPreview.src = currentSlipBase64;
                        slipPreview.style.display = 'block';
                    }
                    if (slipPlaceholder) {
                        slipPlaceholder.style.display = 'none';
                    }
                };
                reader.readAsDataURL(file);
            };
        }

        // Topup Submit
        if (topupForm) {
            topupForm.onsubmit = async (e) => {
                e.preventDefault();
                if (topupErr) { topupErr.style.display = 'none'; topupErr.textContent = ''; }
                if (topupSucc) { topupSucc.style.display = 'none'; topupSucc.textContent = ''; }

                const amount = parseFloat(amountInput?.value);
                const notes = document.getElementById('topup-notes-input')?.value?.trim();

                if (!amount || amount <= 0) {
                    if (topupErr) {
                        topupErr.textContent = 'กรุณาระบุจำนวนเงินที่ถูกต้อง';
                        topupErr.style.display = 'block';
                    }
                    return;
                }

                if (!currentSlipBase64) {
                    if (topupErr) {
                        topupErr.textContent = 'กรุณาแนบรูปสลิปโอนเงิน';
                        topupErr.style.display = 'block';
                    }
                    return;
                }

                if (topupSubmitBtn) {
                    topupSubmitBtn.disabled = true;
                    topupSubmitBtn.innerHTML = '<span>⏳ กำลังส่งข้อมูล...</span>';
                }

                try {
                    const res = await memberFetch('/api/member/credit-deposit', {
                        method: 'POST',
                        body: JSON.stringify({
                            amount,
                            slipUrl: currentSlipBase64,
                            notes
                        })
                    });

                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to submit deposit');

                    if (topupSucc) {
                        topupSucc.textContent = data.message || 'ส่งคำขอเติมเครดิตสำเร็จ! กรุณารอแอดมินตรวจสอบยอดเงิน';
                        topupSucc.style.display = 'block';
                    }

                    if (typeof Notify !== 'undefined' && Notify.success) {
                        Notify.success('ส่งคำขอสำเร็จ', 'แอดมินจะตรวจสอบและอนุมัติเครดิตให้คุณโดยเร็ว');
                    }

                    setTimeout(() => {
                        topupModal.style.display = 'none';
                        // Reset form
                        topupForm.reset();
                        currentSlipBase64 = '';
                        if (slipPreview) slipPreview.style.display = 'none';
                        if (slipPlaceholder) slipPlaceholder.style.display = 'block';
                        // Refresh credit
                        loadMemberCredit();
                    }, 1800);

                } catch (err) {
                    console.error('topup error:', err);
                    if (topupErr) {
                        topupErr.textContent = err.message;
                        topupErr.style.display = 'block';
                    }
                } finally {
                    if (topupSubmitBtn) {
                        topupSubmitBtn.disabled = false;
                        topupSubmitBtn.innerHTML = '<span>🚀 ยืนยันการแจ้งโอนเงิน</span>';
                    }
                }
            };
        }

        // --- Add Tag Modal ---
        const addTagModal = document.getElementById('customer-tags-modal');
        const closeAddTag = document.getElementById('close-customer-tags-modal');
        const btnAddTagConfirm = document.getElementById('btn-cust-add-tag-confirm');
        const addTagErr = document.getElementById('cust-add-tag-error');

        if (closeAddTag && addTagModal) {
            closeAddTag.onclick = () => { addTagModal.style.display = 'none'; };
        }

        if (btnAddTagConfirm) {
            btnAddTagConfirm.onclick = async () => {
                const codeInp = document.getElementById('cust-add-tag-code');
                const nameInp = document.getElementById('cust-add-tag-name');
                if (addTagErr) { addTagErr.style.display = 'none'; addTagErr.textContent = ''; }

                const tag = codeInp?.value.trim().replace(/^#/, '').toUpperCase();
                const tagName = nameInp?.value.trim();

                if (!tag) {
                    if (addTagErr) {
                        addTagErr.textContent = 'กรุณาระบุ Hay Day Player Tag';
                        addTagErr.style.display = 'block';
                    }
                    if (codeInp) codeInp.focus();
                    return;
                }

                btnAddTagConfirm.disabled = true;
                btnAddTagConfirm.textContent = '⏳ กำลังเพิ่มแท็ก...';

                try {
                    const res = await memberFetch('/api/member/tags', {
                        method: 'POST',
                        body: JSON.stringify({ tag, tagName })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to add tag');

                    if (typeof Notify !== 'undefined' && Notify.success) {
                        Notify.success('สำเร็จ', `เพิ่มแท็ก #${tag} เรียบร้อยแล้ว`);
                    }

                    if (codeInp) codeInp.value = '';
                    if (nameInp) nameInp.value = '';
                    if (addTagModal) addTagModal.style.display = 'none';

                    // Refresh
                    await initMemberPortal();
                    loadMemberTags();

                } catch (err) {
                    console.error('add tag error:', err);
                    if (addTagErr) {
                        addTagErr.textContent = err.message;
                        addTagErr.style.display = 'block';
                    }
                } finally {
                    btnAddTagConfirm.disabled = false;
                    btnAddTagConfirm.textContent = '➕ บันทึกแท็ก';
                }
            };
        }

        // --- Edit Profile Modal ---
        const editProfModal = document.getElementById('member-edit-profile-modal');
        const closeEditProf = document.getElementById('close-member-edit-profile-modal');
        const editProfForm = document.getElementById('member-edit-profile-form');
        const editProfErr = document.getElementById('edit-prof-error');

        if (closeEditProf && editProfModal) {
            closeEditProf.onclick = () => { editProfModal.style.display = 'none'; };
        }

        if (editProfForm) {
            editProfForm.onsubmit = async (e) => {
                e.preventDefault();
                if (editProfErr) { editProfErr.style.display = 'none'; }

                const firstName = document.getElementById('edit-prof-firstname')?.value?.trim();
                const lastName = document.getElementById('edit-prof-lastname')?.value?.trim();
                const phone = document.getElementById('edit-prof-phone')?.value?.trim();

                try {
                    const res = await memberFetch('/api/member/profile', {
                        method: 'PUT',
                        body: JSON.stringify({ firstName, lastName, phone })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to update profile');

                    if (typeof Notify !== 'undefined' && Notify.success) {
                        Notify.success('สำเร็จ', 'บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
                    }

                    editProfModal.style.display = 'none';
                    await initMemberPortal();
                    loadMemberProfile();

                } catch (err) {
                    console.error('edit profile error:', err);
                    if (editProfErr) {
                        editProfErr.textContent = err.message;
                        editProfErr.style.display = 'block';
                    }
                }
            };
        }

        // --- Change Password Modal ---
        const chgPwModal = document.getElementById('member-change-password-modal');
        const closeChgPw = document.getElementById('close-member-change-pw-modal');
        const chgPwForm = document.getElementById('member-change-pw-form');
        const chgPwErr = document.getElementById('chg-pw-error');

        if (closeChgPw && chgPwModal) {
            closeChgPw.onclick = () => { chgPwModal.style.display = 'none'; };
        }

        if (chgPwForm) {
            chgPwForm.onsubmit = async (e) => {
                e.preventDefault();
                if (chgPwErr) { chgPwErr.style.display = 'none'; }

                const currentPassword = document.getElementById('chg-pw-current')?.value;
                const newPassword = document.getElementById('chg-pw-new')?.value;
                const confirmPassword = document.getElementById('chg-pw-confirm')?.value;

                if (newPassword !== confirmPassword) {
                    if (chgPwErr) {
                        chgPwErr.textContent = 'รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน';
                        chgPwErr.style.display = 'block';
                    }
                    return;
                }

                try {
                    const res = await memberFetch('/api/member/profile', {
                        method: 'PUT',
                        body: JSON.stringify({
                            action: 'CHANGE_PASSWORD',
                            currentPassword,
                            newPassword
                        })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed to change password');

                    if (typeof Notify !== 'undefined' && Notify.success) {
                        Notify.success('สำเร็จ', 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว');
                    }

                    chgPwForm.reset();
                    chgPwModal.style.display = 'none';

                } catch (err) {
                    console.error('change password error:', err);
                    if (chgPwErr) {
                        chgPwErr.textContent = err.message;
                        chgPwErr.style.display = 'block';
                    }
                }
            };
        }

        // --- Order Detail Modal Close ---
        const closeOrdDetail = document.getElementById('close-member-order-detail-modal');
        const ordDetailModal = document.getElementById('member-order-detail-modal');
        if (closeOrdDetail && ordDetailModal) {
            closeOrdDetail.onclick = () => { ordDetailModal.style.display = 'none'; };
        }

        // --- Insufficient Credit Modal Close ---
        const closeInsuf = document.getElementById('close-member-insufficient-credit-modal');
        const insufModal = document.getElementById('member-insufficient-credit-modal');
        if (closeInsuf && insufModal) {
            closeInsuf.onclick = () => { insufModal.style.display = 'none'; };
        }

        // --- Copy Member ID Button ---
        const copyIdBtn = document.getElementById('btn-copy-member-id');
        if (copyIdBtn) {
            copyIdBtn.onclick = () => {
                const idText = document.getElementById('member-dash-id')?.textContent || '';
                copyTextToClipboard(idText);
            };
        }

        // --- Navigation Listeners ---
        // Desktop nav
        document.querySelectorAll('.member-desktop-nav .member-nav-btn').forEach(btn => {
            btn.onclick = () => {
                const page = btn.dataset.page;
                if (page) switchMemberSubpage(page);
            };
        });

        // Mobile bottom nav
        document.querySelectorAll('#customer-bottom-nav .bottom-nav-item').forEach(btn => {
            btn.onclick = () => {
                const page = btn.dataset.page;
                if (page) switchMemberSubpage(page);
            };
        });

        // Header logout button
        const headerLogout = document.getElementById('btn-header-member-logout');
        if (headerLogout) {
            headerLogout.onclick = () => memberLogout(true);
        }

        // Customer bar logout button
        const barLogout = document.getElementById('btn-cust-logout');
        if (barLogout) {
            barLogout.onclick = () => memberLogout(true);
        }

        // Customer bar topup button
        const barTopup = document.getElementById('btn-cust-topup');
        if (barTopup) {
            barTopup.onclick = openMemberTopupModal;
        }

        // Dashboard topup button
        const dashTopup = document.getElementById('btn-dash-topup');
        if (dashTopup) {
            dashTopup.onclick = openMemberTopupModal;
        }

        // Customer bar refresh wallet button
        const barRefresh = document.getElementById('btn-cust-refresh-wallet');
        if (barRefresh) {
            barRefresh.onclick = async () => {
                barRefresh.style.transform = 'rotate(360deg)';
                await initMemberPortal();
                setTimeout(() => { barRefresh.style.transform = ''; }, 500);
            };
        }

        const dashRefresh = document.getElementById('btn-member-refresh-credit');
        if (dashRefresh) {
            dashRefresh.onclick = async () => {
                dashRefresh.style.transform = 'rotate(360deg)';
                await initMemberPortal();
                setTimeout(() => { dashRefresh.style.transform = ''; }, 500);
            };
        }

        // Guest bar login button
        const guestLoginBtn = document.getElementById('btn-guest-login');
        if (guestLoginBtn) {
            guestLoginBtn.onclick = () => {
                if (typeof window.switchView === 'function') {
                    window.switchView('adminLogin');
                }
            };
        }

        // Orders filter buttons
        document.querySelectorAll('#order-time-filters .btn-filter-pill').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#order-time-filters .btn-filter-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentOrdersFilterTime = btn.dataset.time || 'all';
                loadMemberOrders();
            };
        });

        document.querySelectorAll('#order-status-filters .btn-filter-pill').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('#order-status-filters .btn-filter-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentOrdersFilterStatus = btn.dataset.status || 'ALL';
                loadMemberOrders();
            };
        });

        // Tag selector changes
        const custBarTagSelect = document.getElementById('cust-bar-tag-select');
        if (custBarTagSelect) {
            custBarTagSelect.onchange = (e) => selectActiveTag(e.target.value);
        }
        const smbTagSelect = document.getElementById('smb-tag-select');
        if (smbTagSelect) {
            smbTagSelect.onchange = (e) => selectActiveTag(e.target.value);
        }
    }

    // Modal Openers
    function openMemberTopupModal() {
        const modal = document.getElementById('customer-topup-modal');
        if (modal) {
            const err = document.getElementById('topup-error-msg');
            const succ = document.getElementById('topup-success-msg');
            if (err) err.style.display = 'none';
            if (succ) succ.style.display = 'none';
            modal.style.display = 'flex';
        }
    }

    function openMemberAddTagModal() {
        const modal = document.getElementById('customer-tags-modal');
        if (modal) {
            const err = document.getElementById('cust-add-tag-error');
            if (err) err.style.display = 'none';
            modal.style.display = 'flex';
            const inp = document.getElementById('cust-add-tag-code');
            if (inp) setTimeout(() => inp.focus(), 100);
        }
    }

    function openMemberEditProfileModal() {
        const modal = document.getElementById('member-edit-profile-modal');
        if (modal && memberData) {
            const fn = document.getElementById('edit-prof-firstname');
            const ln = document.getElementById('edit-prof-lastname');
            const ph = document.getElementById('edit-prof-phone');
            if (fn) fn.value = memberData.firstName || '';
            if (ln) ln.value = memberData.lastName || '';
            if (ph) ph.value = memberData.phone || '';
            modal.style.display = 'flex';
        }
    }

    function openMemberChangePasswordModal() {
        const modal = document.getElementById('member-change-password-modal');
        if (modal) {
            const form = document.getElementById('member-change-pw-form');
            if (form) form.reset();
            const err = document.getElementById('chg-pw-error');
            if (err) err.style.display = 'none';
            modal.style.display = 'flex';
        }
    }

    // Helper: Copy text
    function copyTextToClipboard(text) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            if (typeof Notify !== 'undefined' && Notify.success) {
                Notify.success('คัดลอกแล้ว', text);
            } else {
                alert(`คัดลอกเรียบร้อย: ${text}`);
            }
        }).catch(() => {
            alert(`คัดลอก: ${text}`);
        });
    }

    // Member Logout
    function memberLogout(confirmFirst = false) {
        if (confirmFirst && !confirm('คุณต้องการออกจากระบบสมาชิกใช่หรือไม่?')) return;

        localStorage.removeItem('member_token');
        localStorage.removeItem('isMemberLoggedIn');
        localStorage.removeItem('currentMemberSession');

        memberData = null;
        activeTag = null;
        memberOrders = [];
        memberTransactions = [];

        updateMemberVisibilityUI(false);

        if (typeof window.switchView === 'function') {
            window.switchView('customer');
        }

        if (typeof Notify !== 'undefined' && Notify.info) {
            Notify.info('ออกจากระบบ', 'ออกจากระบบสมาชิกเรียบร้อยแล้ว');
        }
    }

    // Expose Global Functions
    window.initMemberPortal = initMemberPortal;
    window.switchMemberSubpage = switchMemberSubpage;
    window.openMemberTopupModal = openMemberTopupModal;
    window.openMemberAddTagModal = openMemberAddTagModal;
    window.openMemberEditProfileModal = openMemberEditProfileModal;
    window.openMemberChangePasswordModal = openMemberChangePasswordModal;
    window.viewOrderDetail = viewOrderDetail;
    window.selectActiveTag = selectActiveTag;
    window.memberLogout = memberLogout;
    window.getMemberBalance = () => (memberData?.wallet?.balance || 0);
    window.getActiveMemberTag = () => activeTag;
    window.isMemberLoggedIn = isMemberLoggedIn;

    // Auto-init on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
        setupMemberModals();
        if (isMemberLoggedIn()) {
            initMemberPortal();
        }
    });

})();
