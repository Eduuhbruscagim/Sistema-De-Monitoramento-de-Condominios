import { supabase } from "../services/supabase.js";

/**
 * ============================================================================
 * 1. UTILS & HELPERS
 * Funções puras para formatação, segurança e datas.
 * ============================================================================
 */
const Utils = {
  // Blinda o frontend contra XSS básico (Sanitization)
  safe: (str) => {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },

  formatBRL: (value) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Number(value || 0));
  },

  formatBRLInteiro: (value) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Math.round(Number(value || 0)));
  },

  // Ajusta o Timezone (UTC -> Local) para exibição correta
  ajustarDataBR: (isoOrDate) => {
    const d = new Date(isoOrDate);
    d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
    return d;
  },

  // Gera string amigável: "Há 5 min", "Há 2 horas"
  formatarTempoRelativo: (data) => {
    const agora = new Date();
    const diff = Math.floor((agora - data) / 1000);
    if (diff < 60) return 'Agora mesmo';
    if (diff < 3600) return `Há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Há ${Math.floor(diff / 3600)} h`;
    return `Há ${Math.floor(diff / 86400)} dias`;
  }
};

/**
 * ============================================================================
 * 2. GLOBAL STATE
 * Gerenciamento de estado da aplicação em memória.
 * ============================================================================
 */
const State = {
  usuarioLogado: null,
  moradoresCache: [],
  idEditando: null,

  // IDs temporários para modais de exclusão
  emailParaDeletar: null,
  reservaParaDeletar: null,
  ocorrenciaParaDeletar: null,

  // Flags de Loading para evitar spam de cliques
  carregandoReservas: false,
  carregandoOcorrencias: false,
};

// Helpers de Acesso Rápido
const isAdmin = () => State.usuarioLogado?.cargo === "Dono" || State.usuarioLogado?.cargo === "admin";
const getMeuUserId = async () => (await supabase.auth.getUser()).data?.user?.id;

/**
 * ============================================================================
 * 3. SERVICES LAYER (DATA)
 * Responsabilidade: Falar com o Supabase e retornar dados brutos.
 * ============================================================================
 */
const MoradorService = {
  async buscarPerfilUsuario() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase.from("moradores").select("*").eq("user_id", session.user.id).maybeSingle();
    if (error) throw new Error(error.message);
    return { session, perfil: data };
  },
  async listarTodos() {
    return await supabase.from("moradores").select("*").order("id", { ascending: false });
  },
  async salvar(dados, id) {
    return await supabase.from("moradores").update(dados).eq("id", id);
  },
  async excluir(email) {
    return await supabase.from("moradores").delete().eq("email", email);
  },
  async logout() {
    await supabase.auth.signOut();
    window.location.href = "../auth/login.html";
  },
};

const ReservaService = {
  async listar() {
    return await supabase.from("vw_reservas_detalhes").select("*").order("data", { ascending: true });
  },
  async criar(area, data) {
    const userId = await getMeuUserId();
    return await supabase.from("reservas").insert([{ user_id: userId, area, data }]);
  },
  async deletar(id) {
    return await supabase.from("reservas").delete().eq("id", id);
  },
};

const OcorrenciaService = {
  async listar() {
    return await supabase.from("vw_ocorrencias_detalhes").select("*").order("created_at", { ascending: false });
  },
  async criar(titulo, descricao) {
    const userId = await getMeuUserId();
    return await supabase.from("ocorrencias").insert([{ user_id: userId, titulo, descricao }]);
  },
  async deletar(id) {
    return await supabase.from("ocorrencias").delete().eq("id", id);
  },
};

const CaixaService = {
  async saldo() {
    return await supabase.from("vw_saldo_caixa").select("saldo").single();
  },
  async listarPublico() {
    return await supabase.from("vw_caixa_movimentos_publico").select("*").order("created_at", { ascending: false }).limit(100);
  },
  async movimentar(tipo, valor, descricao) {
    const userId = await getMeuUserId();
    return await supabase.from("caixa_movimentos").insert([{ user_id: userId, tipo, valor, descricao }]);
  },
};

const KpiService = {
  async unidades() {
    return await supabase.rpc("kpi_unidades");
  },
};

// Serviço agregador para o Notification Center
const NotificationService = {
  async buscarTudo() {
    // Busca paralela para performance máxima
    const [ocorrencias, reservas, caixa] = await Promise.all([
      OcorrenciaService.listar(),
      ReservaService.listar(),
      CaixaService.listarPublico()
    ]);

    const lista = [];

    // Normalização: Ocorrências
    if (ocorrencias.data) {
      ocorrencias.data.forEach(o => lista.push({
        tipo: 'ocorrencia',
        titulo: 'Nova Ocorrência',
        desc: o.titulo || 'Sem título',
        data: new Date(o.created_at),
        icon: 'fa-triangle-exclamation',
        color: 'bg-notif-orange'
      }));
    }

    // Normalização: Reservas
    if (reservas.data) {
      reservas.data.forEach(r => {
        // Usa data de criação se existir, senão usa data do evento como fallback
        const dataRef = r.created_at ? new Date(r.created_at) : new Date(r.data);
        lista.push({
          tipo: 'reserva',
          titulo: 'Reserva Confirmada',
          desc: `${r.area} - ${Utils.ajustarDataBR(r.data).toLocaleDateString('pt-BR')}`,
          data: dataRef,
          icon: 'fa-calendar-check',
          color: 'bg-notif-purple'
        });
      });
    }

    // Normalização: Caixa
    if (caixa.data) {
      caixa.data.forEach(c => {
        const isEntrada = c.tipo === 'entrada';
        lista.push({
          tipo: 'caixa',
          titulo: isEntrada ? 'Entrada no Caixa' : 'Saída do Caixa',
          desc: `${Utils.formatBRL(c.valor)} - ${c.descricao}`,
          data: new Date(c.created_at),
          icon: isEntrada ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
          color: isEntrada ? 'bg-notif-green' : 'bg-notif-blue'
        });
      });
    }

    // Ordena DESC (mais recente primeiro) e corta nos 20 primeiros
    return lista.sort((a, b) => b.data - a.data).slice(0, 20);
  }
};

/**
 * ============================================================================
 * 4. UI LAYER (CONTROLLERS)
 * Responsabilidade: Manipular o DOM, Modais e HTML.
 * ============================================================================
 */

// Controlador Genérico de Modais
const ModalUX = {
  overlays: [],
  init() {
    this.overlays = Array.from(document.querySelectorAll(".modal-overlay"));

    // Fechar ao clicar no backdrop
    this.overlays.forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.close(overlay);
      });
    });

    // Fechar com ESC
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const aberto = this.overlays.find((m) => m.classList.contains("active"));
      if (aberto) this.close(aberto);
    });

    // Botões de fechar (X) e Cancelar
    document.querySelectorAll(".close-modal, .close-modal-reserva, .btn-outline").forEach(btn => {
      btn.addEventListener("click", () => {
        this.closeAll();
        // Limpa estados de deleção
        State.reservaParaDeletar = null;
        State.ocorrenciaParaDeletar = null;
        State.emailParaDeletar = null;
      });
    });
  },
  open(overlay) {
    if (!overlay) return;
    overlay.classList.add("active");
    document.body.classList.add("modal-open");
  },
  close(overlay) {
    if (!overlay) return;
    overlay.classList.remove("active");
    const algumAberto = this.overlays.some((m) => m.classList.contains("active"));
    if (!algumAberto) document.body.classList.remove("modal-open");
  },
  closeAll() {
    this.overlays.forEach((m) => m.classList.remove("active"));
    document.body.classList.remove("modal-open");
  },
};

// Controlador Principal da UI (Sidebar, Toast, User Info)
const UI = {
  elements: {
    toastContainer: document.getElementById("toast-container"),
    userAvatar: document.getElementById("user-avatar"),
    userName: document.getElementById("user-name"),
    userRole: document.getElementById("user-role"),
    kpiSaldo: document.getElementById("kpi-saldo"),
    kpiSaldoSub: document.getElementById("kpi-saldo-sub"),
    kpiOcorrencias: document.getElementById("kpi-ocorrencias"),
    kpiOcorrenciasSub: document.getElementById("kpi-ocorrencias-sub"),
    kpiUnidades: document.getElementById("kpi-unidades"),
    kpiUnidadesSub: document.getElementById("kpi-unidades-sub"),
    recentActivities: document.getElementById("recent-activities"),
  },

  showToast(message, type = "success") {
    // Mapeamento de Ícones e Títulos
    const icons = {
      success: 'fa-check',
      error: 'fa-xmark',
      info: 'fa-info'
    };
    const titles = {
      success: 'Sucesso',
      error: 'Erro',
      info: 'Informação'
    };

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    // HTML Estruturado para o novo CSS
    toast.innerHTML = `
      <div class="toast-icon-box">
        <i class="fa-solid ${icons[type] || 'fa-bell'}"></i>
      </div>
      <div class="toast-content">
        <span class="toast-title">${titles[type]}</span>
        <span class="toast-msg">${Utils.safe(message)}</span>
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()" aria-label="Fechar">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;

    // Remove ao clicar (já incluso no button onclick, mas adicionamos aqui para garantir)
    toast.addEventListener('click', () => {
        toast.style.animation = "toastExit 0.3s forwards";
        setTimeout(() => toast.remove(), 300);
    });

    if (this.elements.toastContainer) {
      this.elements.toastContainer.appendChild(toast);

      // Auto-remove após 4s
      setTimeout(() => {
        // Se ainda estiver no DOM (usuário não fechou)
        if (toast.isConnected) {
            toast.style.animation = "toastExit 0.5s forwards";
            setTimeout(() => toast.remove(), 500);
        }
      }, 4000);
    } else {
      // Fallback extremo
      console.warn("Toast container missing");
      alert(message);
    }
  },

  atualizarSidebar(perfil) {
    if (!perfil) return;
    const nome = Utils.safe(perfil.nome || "Usuário");

    if (this.elements.userName) this.elements.userName.innerText = nome;

    const cargoAmigavel = perfil.cargo === "Dono" ? "Dono" : perfil.cargo === "admin" ? "Síndico" : "Morador";
    if (this.elements.userRole) this.elements.userRole.innerText = cargoAmigavel;
    if (this.elements.userAvatar) this.elements.userAvatar.innerText = nome.charAt(0).toUpperCase();
  },

  async renderizarKPIs() {
    // 1. Saldo (KPI)
    if (this.elements.kpiSaldo) {
      this.elements.kpiSaldo.innerText = "...";
      const { data, error } = await CaixaService.saldo();
      if (error) {
        this.elements.kpiSaldo.innerText = "Restrito";
        if (this.elements.kpiSaldoSub) this.elements.kpiSaldoSub.innerText = "Sem acesso";
      } else {
        this.elements.kpiSaldo.innerText = Utils.formatBRLInteiro(data?.saldo || 0);
        if (this.elements.kpiSaldoSub) this.elements.kpiSaldoSub.innerText = "Atualizado em tempo real";
      }
    }

    // 2. Ocorrências (KPI)
    if (this.elements.kpiOcorrencias) {
      const { data, error } = await OcorrenciaService.listar();
      if (error || !data) {
        this.elements.kpiOcorrencias.innerText = "0 Abertas";
      } else {
        const abertas = data.filter(o => (o.status || "").toLowerCase() === "aberta").length;
        const urgentes = data.filter(o => (o.status || "").toLowerCase() === "urgente").length;
        this.elements.kpiOcorrencias.innerText = `${abertas} Abertas`;
        if (this.elements.kpiOcorrenciasSub) this.elements.kpiOcorrenciasSub.innerText = `${urgentes} Urgente`;
      }
    }

    // 3. Unidades (KPI)
    if (this.elements.kpiUnidades) {
      const { data } = await KpiService.unidades();
      if (data && data[0]) {
        const { total, ocupadas, vazias } = data[0];
        this.elements.kpiUnidades.innerText = `${ocupadas}/${total}`;
        if (this.elements.kpiUnidadesSub) this.elements.kpiUnidadesSub.innerText = `${vazias} Vazias`;
      }
    }
  },

  async renderizarAtividadesRecentes() {
    if (!this.elements.recentActivities) return;

    this.elements.recentActivities.innerHTML = `
      <div class="activity-item">
        <div class="activity-icon bg-blue"><i class="fa-solid fa-clock"></i></div>
        <div class="activity-info"><h4>Carregando...</h4></div>
      </div>`;

    const { data, error } = await ReservaService.listar();

    if (error) {
      this.elements.recentActivities.innerHTML = `<div class="activity-item">Erro ao carregar atividades.</div>`;
      return;
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const futuras = (data || [])
      .map(r => ({ ...r, dataObj: Utils.ajustarDataBR(r.data) }))
      .filter(r => r.dataObj >= hoje)
      .sort((a, b) => a.dataObj - b.dataObj)
      .slice(0, 2);

    if (futuras.length === 0) {
      this.elements.recentActivities.innerHTML = `
        <div class="activity-item">
          <div class="activity-icon bg-blue"><i class="fa-regular fa-face-smile-beam"></i></div>
          <div class="activity-info"><h4>Nenhuma reserva próxima</h4><p>Tudo tranquilo.</p></div>
        </div>`;
      return;
    }

    const souDono = isAdmin();
    this.elements.recentActivities.innerHTML = futuras.map(r => {
      const diffDias = Math.ceil((r.dataObj - hoje) / (1000 * 60 * 60 * 24));
      const quando = diffDias === 0 ? "Hoje" : `Em ${diffDias}d`;
      const linhaInfo = souDono ? Utils.safe(r.nome_morador || "Morador") : `Data: ${r.dataObj.toLocaleDateString("pt-BR")}`;

      return `
        <div class="activity-item">
          <div class="activity-icon bg-blue"><i class="fa-solid fa-calendar-day"></i></div>
          <div class="activity-info">
            <h4>Reserva: ${Utils.safe(r.area)}</h4>
            <p>${linhaInfo}</p>
          </div>
          <span class="activity-time">${quando}</span>
        </div>`;
    }).join("");
  }
};

// Controlador das Notificações (Sino)
const UINotifications = {
  btn: document.getElementById('btn-notifications'),
  panel: document.getElementById('notifications-panel'),
  list: document.getElementById('notifications-list'),
  badge: document.getElementById('notif-badge'),
  // Aqui pegamos o wrapper que definimos no HTML
  wrapper: document.querySelector('.notifications-wrapper'),
  overlay: null, // Será injetado dinamicamente
  isOpen: false,

  init() {
    if (!this.btn) return;

    // Injeta o overlay no DOM se não existir (garantia de que o elemento existe)
    if (!document.getElementById('blur-overlay')) {
      this.overlay = document.createElement('div');
      this.overlay.id = 'blur-overlay';
      document.body.appendChild(this.overlay);
    } else {
      this.overlay = document.getElementById('blur-overlay');
    }

    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Fechar ao clicar fora (no overlay ou em qualquer outro lugar)
    document.addEventListener('click', (e) => {
      // Se estiver aberto E o clique não foi no painel NEM no botão
      if (this.isOpen && !this.panel.contains(e.target) && !this.btn.contains(e.target)) {
        this.close();
      }
    });
  },

  async toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    this.isOpen = true;
    this.panel.classList.add('active');

    // Ativa o vidro fosco no fundo
    if (this.overlay) this.overlay.classList.add('active');

    // Eleva o dropdown acima do vidro fosco (Z-Index boost)
    if (this.wrapper) this.wrapper.classList.add('highlight-wrapper');

    if (this.badge) this.badge.style.display = 'none';
    this.render(); // Carrega dados
  },

  close() {
    this.isOpen = false;
    this.panel.classList.remove('active');

    // Remove o vidro fosco
    if (this.overlay) this.overlay.classList.remove('active');

    // Restaura o Z-Index normal do dropdown
    if (this.wrapper) this.wrapper.classList.remove('highlight-wrapper');
  },

  async render() {
    this.list.innerHTML = `<div style="padding:20px;text-align:center;color:#94a3b8"><i class="fa-solid fa-circle-notch fa-spin"></i> Buscando...</div>`;
    try {
      const itens = await NotificationService.buscarTudo();
      if (itens.length === 0) {
        this.list.innerHTML = `<div style="padding:30px;text-align:center;color:#94a3b8">Nenhuma notificação recente.</div>`;
        return;
      }

      this.list.innerHTML = itens.map(item => `
        <div class="notif-item">
          <div class="notif-icon ${item.color}"><i class="fa-solid ${item.icon}"></i></div>
          <div class="notif-content">
            <span class="notif-title">${Utils.safe(item.titulo)}</span>
            <span class="notif-desc">${Utils.safe(item.desc)}</span>
            <span class="notif-time">${Utils.formatarTempoRelativo(item.data)}</span>
          </div>
        </div>
      `).join('');
    } catch (err) {
      this.list.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444">Erro ao carregar notificações.</div>`;
    }
  }
};

// Controlador de Reservas
const UIReserva = {
  lista: document.getElementById("lista-reservas"),
  modal: document.getElementById("modal-reserva"),
  form: document.getElementById("form-reserva"),
  modalDelete: document.getElementById("modal-confirm-delete-reserva"),
  btnConfirmDelete: document.getElementById("btn-confirm-delete-reserva"),

  init() {
    if (this.form) {
      // Bloqueia datas passadas
      const inputData = document.getElementById("reserva-data");
      if (inputData) inputData.min = new Date().toISOString().split("T")[0];

      this.form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const area = document.getElementById("reserva-area")?.value;
        const data = document.getElementById("reserva-data")?.value;

        const btn = this.form.querySelector("button");
        const original = btn.innerText;
        btn.innerText = "Agendando...";
        btn.disabled = true;

        const { error } = await ReservaService.criar(area, data);
        if (error) {
          UI.showToast(error.code === "23505" ? "Data indisponível!" : error.message, "error");
        } else {
          UI.showToast("Reserva confirmada!", "success");
          ModalUX.close(this.modal);
        }
        btn.innerText = original;
        btn.disabled = false;
      });
    }

    if (this.btnConfirmDelete) {
      this.btnConfirmDelete.addEventListener("click", async () => {
        if (!State.reservaParaDeletar) return;
        const { error } = await ReservaService.deletar(State.reservaParaDeletar);
        if (error) UI.showToast(error.message, "error");
        else UI.showToast("Reserva cancelada.", "info");

        ModalUX.close(this.modalDelete);
        State.reservaParaDeletar = null;
      });
    }
  },

  async carregar() {
    if (!this.lista || State.carregandoReservas) return;
    State.carregandoReservas = true;

    if (!this.lista.children.length) {
      this.lista.innerHTML = `<tr><td colspan="4" style="text-align:center">Carregando...</td></tr>`;
    }

    try {
      const { data, error } = await ReservaService.listar();
      if (error) throw error;

      const souDono = isAdmin();
      const meuId = State.usuarioLogado?.user_id;

      const thead = document.getElementById("thead-reservas");
      if (thead) {
        thead.innerHTML = souDono
          ? `<th>Data</th><th>Área</th><th>Reservado Por</th><th>Ações</th>`
          : `<th>Data</th><th>Área</th><th>Ações</th>`;
      }

      if (!data?.length) {
        const colspan = souDono ? 4 : 3;
        this.lista.innerHTML = `
          <tr class="no-reservas"><td colspan="${colspan}">
            <div style="display:flex;flex-direction:column;align-items:center;padding:20px;gap:10px">
              <i class="fa-regular fa-face-smile-beam" style="font-size:1.5rem;color:#2563eb"></i>
              <span>Nenhuma reserva futura.</span>
            </div>
          </td></tr>`;
        return;
      }

      this.lista.innerHTML = data.map(r => {
        const dataObj = Utils.ajustarDataBR(r.data);
        const podeCancelar = souDono || r.user_id === meuId;

        const btn = podeCancelar
          ? `<button class="action-btn" onclick="deletarReserva(${r.id})" style="color:#ef4444"><i class="fa-regular fa-trash-can"></i></button>`
          : `<button class="action-btn action-btn-locked"><i class="fa-solid fa-lock"></i></button>`;

        const cols = souDono
          ? `<td data-label="Data" class="td-destaque">${dataObj.toLocaleDateString("pt-BR")}</td>
             <td data-label="Área" class="td-titulo">${Utils.safe(r.area)}</td>
             <td data-label="Reservado Por" class="td-texto">${Utils.safe(r.nome_morador)}</td>
             <td class="td-acao">${btn}</td>`
          : `<td data-label="Data" class="td-destaque">${dataObj.toLocaleDateString("pt-BR")}</td>
             <td data-label="Área" class="td-titulo">${Utils.safe(r.area)}</td>
             <td class="td-acao">${btn}</td>`;

        return `<tr>${cols}</tr>`;
      }).join("");

    } catch (e) {
      this.lista.innerHTML = `<tr><td colspan="4" style="text-align:center">Erro ao carregar.</td></tr>`;
    } finally {
      State.carregandoReservas = false;
    }
  }
};

// Controlador de Ocorrências
const UIOcorrencias = {
  lista: document.getElementById("lista-ocorrencias"),
  modal: document.getElementById("modal-ocorrencia"),
  form: document.getElementById("form-ocorrencia"),
  modalDelete: document.getElementById("modal-confirm-delete-ocorrencia"),
  btnConfirmDelete: document.getElementById("btn-confirm-delete-ocorrencia"),

  init() {
    const btns = [document.getElementById("btn-nova-ocorrencia"), document.getElementById("btn-nova-ocorrencia-2")];
    btns.forEach(b => b?.addEventListener("click", () => ModalUX.open(this.modal)));

    if (this.form) {
      this.form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const t = document.getElementById("oc-titulo")?.value;
        const d = document.getElementById("oc-descricao")?.value;

        const btn = this.form.querySelector("button");
        const original = btn.innerText;
        btn.innerText = "Enviando...";
        btn.disabled = true;

        const { error } = await OcorrenciaService.criar(t, d);
        if (error) UI.showToast(error.message, "error");
        else {
          UI.showToast("Ocorrência Registrada!", "success");
          this.form.reset();
          ModalUX.close(this.modal);
        }
        btn.innerText = original;
        btn.disabled = false;
      });
    }

    if (this.btnConfirmDelete) {
      this.btnConfirmDelete.addEventListener("click", async () => {
        if (!State.ocorrenciaParaDeletar) return;
        const { error } = await OcorrenciaService.deletar(State.ocorrenciaParaDeletar);
        if (error) UI.showToast(error.message, "error");
        else UI.showToast("Excluída.", "info");
        ModalUX.close(this.modalDelete);
        State.ocorrenciaParaDeletar = null;
      });
    }
  },

  async carregar() {
    if (!this.lista || State.carregandoOcorrencias) return;
    State.carregandoOcorrencias = true;

    try {
      const souAdmin = isAdmin();
      const tabela = document.querySelector(".tabela-ocorrencias");
      const thead = tabela?.querySelector("thead tr");

      // Ajusta colunas dinamicamente baseado no cargo
      if (thead) {
        if (souAdmin) {
          tabela.classList.remove("morador-view");
          thead.innerHTML = `<th>Data</th><th>Ocorrência</th><th>Morador</th><th>Contato</th><th>Status</th><th>Ações</th>`;
        } else {
          tabela.classList.add("morador-view");
          thead.innerHTML = `<th>Data</th><th>Ocorrência</th><th>Status</th><th>Ações</th>`;
        }
      }

      if (!this.lista.children.length) {
        this.lista.innerHTML = `<tr><td colspan="6" style="text-align:center">Carregando...</td></tr>`;
      }

      const { data, error } = await OcorrenciaService.listar();
      if (error) throw error;

      if (!data?.length) {
        this.lista.innerHTML = `<tr><td colspan="6" style="text-align:center">Nenhuma ocorrência.</td></tr>`;
        return;
      }

      this.lista.innerHTML = data.map(o => {
        const d = new Date(o.created_at).toLocaleDateString("pt-BR");
        const podeExcluir = souAdmin || o.minha;

        const btn = podeExcluir
          ? `<button class="action-btn" onclick="deletarOcorrencia(${o.id})" style="color:#ef4444"><i class="fa-regular fa-trash-can"></i></button>`
          : `<button class="action-btn action-btn-locked"><i class="fa-solid fa-lock"></i></button>`;

        if (souAdmin) {
          return `<tr>
            <td data-label="Data" class="td-destaque">${d}</td>
            <td data-label="Ocorrência" class="td-titulo">${Utils.safe(o.titulo)}</td>
            <td data-label="Morador" class="td-texto">${Utils.safe(o.registrador_nome)}</td>
            <td data-label="Contato" class="td-texto">${Utils.safe(o.registrador_celular)}</td>
            <td data-label="Status" class="td-texto" style="text-transform:capitalize">${Utils.safe(o.status)}</td>
            <td class="td-acao">${btn}</td>
          </tr>`;
        } else {
          return `<tr>
            <td data-label="Data" class="td-destaque">${d}</td>
            <td data-label="Ocorrência" class="td-titulo">${Utils.safe(o.titulo)}</td>
            <td data-label="Status" class="td-texto" style="text-transform:capitalize">${Utils.safe(o.status)}</td>
            <td class="td-acao">${btn}</td>
          </tr>`;
        }
      }).join("");

    } catch (e) {
      this.lista.innerHTML = `<tr><td colspan="6" style="text-align:center">Erro ao carregar.</td></tr>`;
    } finally {
      State.carregandoOcorrencias = false;
    }
  }
};

// Controlador do Caixa
const UICaixa = {
  modal: document.getElementById("modal-caixa"),
  form: document.getElementById("form-caixa"),
  modalHistorico: document.getElementById("modal-caixa-historico"),
  listaHistorico: document.getElementById("lista-caixa-movimentos"),
  btnAjustar: document.getElementById("btn-ajustar-caixa"),
  btnVer: document.getElementById("btn-ver-caixa"),

  init() {
    if (this.btnAjustar) {
      this.btnAjustar.style.display = isAdmin() ? "flex" : "none";
      this.btnAjustar.addEventListener("click", () => ModalUX.open(this.modal));
    }

    if (this.btnVer) {
      this.btnVer.addEventListener("click", () => {
        this.carregarExtrato();
        ModalUX.open(this.modalHistorico);
      });
    }

    if (this.form) {
      this.form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!isAdmin()) return UI.showToast("Acesso negado", "error");

        const t = document.getElementById("cx-tipo")?.value;
        const v = document.getElementById("cx-valor")?.value;
        const d = document.getElementById("cx-desc")?.value;

        const btn = this.form.querySelector("button");
        const original = btn.innerText;
        btn.innerText = "Salvando...";
        btn.disabled = true;

        const { error } = await CaixaService.movimentar(t, v, d);
        if (error) UI.showToast(error.message, "error");
        else {
          UI.showToast("Caixa atualizado", "success");
          this.form.reset();
          ModalUX.close(this.modal);
        }
        btn.innerText = original;
        btn.disabled = false;
      });
    }
  },

  async carregarExtrato() {
    if (!this.listaHistorico) return;
    this.listaHistorico.innerHTML = `<tr><td colspan="4" style="text-align:center">Carregando...</td></tr>`;

    const { data, error } = await CaixaService.listarPublico();
    if (error || !data?.length) {
      this.listaHistorico.innerHTML = `<tr><td colspan="4" style="text-align:center">Sem movimentações.</td></tr>`;
      return;
    }

    this.listaHistorico.innerHTML = data.map(m => {
      const d = new Date(m.created_at).toLocaleDateString("pt-BR");
      const tipo = m.tipo === "entrada" ? "Entrada" : "Saída";
      const sinal = tipo === "Entrada" ? "+" : "-";

      return `<tr>
        <td data-label="Data" class="td-destaque"><strong>${d}</strong></td>
        <td data-label="Tipo" class="td-texto">${tipo}</td>
        <td data-label="Valor" class="td-titulo"><strong>${sinal} ${Utils.formatBRL(m.valor)}</strong></td>
        <td data-label="Descrição" class="td-texto">${Utils.safe(m.descricao)}</td>
      </tr>`;
    }).join("");
  }
};

// Controlador de Moradores
const UIMoradores = {
  tabela: document.getElementById("lista-moradores"),
  modal: document.getElementById("modal-novo-morador"),
  form: document.getElementById("form-morador"),
  modalDelete: document.getElementById("modal-confirm-delete"),
  btnDelete: document.getElementById("btn-confirm-delete"),

  init() {
    // Máscara Celular
    const inputCel = document.getElementById("celular");
    inputCel?.addEventListener("input", e => {
      let v = e.target.value.replace(/\D/g, "").substring(0, 11);
      v = v.replace(/^(\d{2})(\d)/g, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
      e.target.value = v;
    });

    // Formatar Bloco para Uppercase
    document.getElementById("unidade-bloco")?.addEventListener("input", e => e.target.value = e.target.value.toUpperCase());

    // Submit Edição
    this.form?.addEventListener("submit", async e => {
      e.preventDefault();
      if (!State.idEditando || !isAdmin()) return;

      const btn = this.form.querySelector("button");
      btn.disabled = true;

      const unidade = `${document.getElementById("unidade-num").value} - Bloco ${document.getElementById("unidade-bloco").value}`;
      const dados = {
        nome: document.getElementById("nome").value,
        celular: document.getElementById("celular").value,
        tipo: document.getElementById("tipo").value,
        status: document.getElementById("status").value,
        unidade,
        img: `https://ui-avatars.com/api/?name=${encodeURIComponent(document.getElementById("nome").value)}&background=random`
      };

      await MoradorService.salvar(dados, State.idEditando);
      UI.showToast("Salvo com sucesso!");
      ModalUX.close(this.modal);
      this.carregar();
      btn.disabled = false;
    });

    // Eventos da Tabela (Editar/Excluir) via Delegação
    this.tabela?.addEventListener("click", e => {
      const btnEdit = e.target.closest(".btn-editar");
      const btnDel = e.target.closest(".btn-excluir");

      if (btnEdit) {
        const id = Number(btnEdit.dataset.id);
        const m = State.moradoresCache.find(x => x.id === id);
        if (m) {
          State.idEditando = id;
          this.preencherModal(m);
          ModalUX.open(this.modal);
        }
      }
      if (btnDel) {
        State.emailParaDeletar = btnDel.dataset.email;
        ModalUX.open(this.modalDelete);
      }
    });

    // Confirmar Exclusão
    this.btnDelete?.addEventListener("click", async () => {
      if (!State.emailParaDeletar) return;
      await MoradorService.excluir(State.emailParaDeletar);
      UI.showToast("Morador removido");
      ModalUX.close(this.modalDelete);
      State.emailParaDeletar = null;
      this.carregar();
    });
  },

  preencherModal(m) {
    document.getElementById("nome").value = m.nome;
    const emailInput = document.getElementById("email-novo");
    emailInput.value = m.email;
    emailInput.disabled = true; // Email não edita
    document.getElementById("celular").value = m.celular;
    document.getElementById("tipo").value = m.tipo;
    document.getElementById("status").value = m.status;

    if (m.unidade?.includes(" - Bloco ")) {
      const [n, b] = m.unidade.split(" - Bloco ");
      document.getElementById("unidade-num").value = n;
      document.getElementById("unidade-bloco").value = b;
    }
  },

  async carregar() {
    const { data } = await MoradorService.listarTodos();
    State.moradoresCache = data || [];
    this.render();
  },

  render() {
    if (!this.tabela) return;
    const podeEditar = isAdmin();

    this.tabela.innerHTML = State.moradoresCache.map(m => {
      const badgeClass = m.status === "ok" ? "status-ok" : "status-late";
      const badgeText = m.status === "ok" ? "Em dia" : "Atrasado";
      const img = m.img || `https://ui-avatars.com/api/?name=${m.nome}&background=random`;

      const actions = podeEditar
        ? `<button class="action-btn btn-editar" data-id="${m.id}"><i class="fa-regular fa-pen-to-square"></i></button>
           <button class="action-btn btn-excluir" data-email="${m.email}" style="color:#ef4444"><i class="fa-regular fa-trash-can"></i></button>`
        : `<button class="action-btn action-btn-locked"><i class="fa-solid fa-lock"></i></button>`;

      return `<tr>
        <td>
          <div class="user-cell">
            <img src="${img}" class="user-avatar" />
            <div><strong class="td-titulo">${Utils.safe(m.nome)}</strong><br/><small>${Utils.safe(m.tipo)}</small></div>
          </div>
        </td>
        <td class="td-texto"><strong>${Utils.safe(m.unidade)}</strong></td>
        <td class="td-texto">${Utils.safe(m.celular)}</td>
        <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
        <td class="td-acao">${actions}</td>
      </tr>`;
    }).join("");
  }
};

/**
 * ============================================================================
 * 5. MAIN INIT & REALTIME
 * Ponto de entrada da aplicação.
 * ============================================================================
 */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // 1. Auth Check
    const auth = await MoradorService.buscarPerfilUsuario();
    if (!auth) {
      window.location.href = "../auth/login.html";
      return;
    }

    State.usuarioLogado = auth.perfil;
    UI.atualizarSidebar(State.usuarioLogado);

    // 2. Inicializar Componentes (Listeners)
    ModalUX.init();
    UIReserva.init();
    UIOcorrencias.init();
    UICaixa.init();
    UIMoradores.init();
    UINotifications.init();

    // 3. Carga Inicial de Dados (Paralela)
    await Promise.all([
      UI.renderizarKPIs(),
      UI.renderizarAtividadesRecentes(),
      UIMoradores.carregar()
    ]);

    // 4. Setup Realtime (Supabase)
    // Escuta mudanças em todas as tabelas relevantes e atualiza a UI
    const channel = supabase.channel("dashboard-changes");
    channel
      .on("postgres_changes", { event: "*", schema: "public", table: "ocorrencias" }, () => {
        UI.renderizarKPIs();
        if (document.getElementById("view-ocorrencias").classList.contains("active")) UIOcorrencias.carregar();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, () => {
        UI.renderizarAtividadesRecentes();
        if (document.getElementById("view-reservas").classList.contains("active")) UIReserva.carregar();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "caixa_movimentos" }, () => {
        UI.renderizarKPIs();
        if (UICaixa.modalHistorico.classList.contains("active")) UICaixa.carregarExtrato();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "moradores" }, () => {
        UI.renderizarKPIs(); // Atualiza contador de unidades
        if (document.getElementById("view-moradores").classList.contains("active")) UIMoradores.carregar();
      })
      .subscribe();

    console.log("🚀 Dashboard carregado e sincronizado.");

  } catch (err) {
    console.error("Fatal Error:", err);
    UI.showToast("Erro ao inicializar sistema.", "error");
  }

  // 5. Navegação Sidebar (SPA simples)
  document.querySelectorAll(".sidebar-menu .menu-item").forEach(link => {
    link.addEventListener("click", async (e) => {
      if (link.classList.contains("logout")) {
        e.preventDefault();
        return MoradorService.logout();
      }

      e.preventDefault();
      const targetId = link.dataset.view;
      const title = link.dataset.title;

      // Troca de Aba
      document.querySelectorAll(".menu-item").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      document.querySelectorAll(".view-section").forEach(s => s.classList.remove("active"));
      document.getElementById(targetId).classList.add("active");
      document.querySelector(".top-bar .page-title").innerText = title;

      // Lazy Load para economizar banda
      if (targetId === "view-reservas") await UIReserva.carregar();
      if (targetId === "view-ocorrencias") await UIOcorrencias.carregar();
    });
  });

  // 6. Global Window Exports (para onclicks inline do HTML)
  // Necessário porque estamos em um módulo ES6
  window.abrirModalReserva = (area) => {
    document.getElementById("reserva-area").value = area;
    document.getElementById("label-area-selecionada").innerText = area;
    ModalUX.open(UIReserva.modal);
  };

  window.deletarReserva = (id) => {
    State.reservaParaDeletar = id;
    ModalUX.open(UIReserva.modalDelete);
  };

  window.deletarOcorrencia = (id) => {
    State.ocorrenciaParaDeletar = id;
    ModalUX.open(UIOcorrencias.modalDelete);
  };

  window.fecharModalExclusao = () => ModalUX.closeAll();
  window.fecharModalExclusaoReserva = () => ModalUX.closeAll();
  window.fecharModalExclusaoOcorrencia = () => ModalUX.closeAll();
});