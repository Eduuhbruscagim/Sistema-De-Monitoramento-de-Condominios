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
    if (diff < 60) return "Agora mesmo";
    if (diff < 3600) return `Há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Há ${Math.floor(diff / 3600)} h`;
    return `Há ${Math.floor(diff / 86400)} dias`;
  },
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

  // Cache de dados (Single Source of Truth)
  reservasCache: null,
  ocorrenciasCache: null,
  caixaCache: null,
  notificacoesCache: null,

  // IDs temporários para modais de exclusão
  emailParaDeletar: null,
  reservaParaDeletar: null,
  ocorrenciaParaDeletar: null,

  // Flags de Loading para evitar spam de cliques
  carregandoReservas: false,
  carregandoOcorrencias: false,
  carregandoCaixa: false,
  carregandoNotificacoes: false,
  carregandoKPIs: false, // Nova flag para controlar estado dos KPIs
};

// Helpers de Acesso Rápido
const isAdmin = () =>
  State.usuarioLogado?.cargo === "Dono" ||
  State.usuarioLogado?.cargo === "admin";

const getMeuUserId = async () => {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    throw new Error("Usuário não autenticado");
  }
  return data.user.id;
};

/**
 * ============================================================================
 * 3. SERVICES LAYER (DATA)
 * Responsabilidade: Falar com o Supabase e retornar dados brutos.
 * ============================================================================
 */
const MoradorService = {
  async buscarPerfilUsuario() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;
    const { data, error } = await supabase
      .from("moradores")
      .select(
        "id, nome, email, cargo, user_id, celular, tipo, status, unidade, img"
      )
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { session, perfil: data };
  },
  async listarTodos() {
    return await supabase
      .from("moradores")
      .select("id, nome, email, cargo, celular, tipo, status, unidade, img")
      .order("id", { ascending: false });
  },
  async salvar(dados, id) {
    return await supabase.from("moradores").update(dados).eq("id", id);
  },
  async excluir(email) {
    return await supabase.from("moradores").delete().eq("email", email);
  },
  async logout() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Erro ao fazer logout:", error);
        UI.showToast("Erro ao desconectar. Redirecionando...", "error");
        setTimeout(() => {
          window.location.href = "../auth/login.html";
        }, 1000);
      } else {
        State.usuarioLogado = null;
        State.reservasCache = null;
        State.ocorrenciasCache = null;
        State.caixaCache = null;
        State.notificacoesCache = null;
        State.moradoresCache = [];
        window.location.href = "../auth/login.html";
      }
    } catch (err) {
      console.error("Erro fatal no logout:", err);
      window.location.href = "../auth/login.html";
    }
  },
};

const ReservaService = {
  async listar() {
    return await supabase
      .from("vw_reservas_detalhes")
      .select("id, area, data, user_id, nome_morador, created_at")
      .order("data", { ascending: true });
  },
  async criar(area, data) {
    const userId = await getMeuUserId();
    return await supabase
      .from("reservas")
      .insert([{ user_id: userId, area, data }]);
  },
  async deletar(id) {
    return await supabase.from("reservas").delete().eq("id", id);
  },
};

const OcorrenciaService = {
  async listar() {
    return await supabase
      .from("vw_ocorrencias_detalhes")
      .select(
        "id, titulo, descricao, status, created_at, minha, registrador_nome, registrador_unidade, registrador_celular"
      )
      .order("created_at", { ascending: false })
      .limit(50);
  },
  async criar(titulo, descricao) {
    const userId = await getMeuUserId();
    return await supabase
      .from("ocorrencias")
      .insert([{ user_id: userId, titulo, descricao }]);
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
    return await supabase
      .from("vw_caixa_movimentos_publico")
      .select("id, tipo, valor, descricao, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
  },
  async movimentar(tipo, valor, descricao) {
    const userId = await getMeuUserId();
    return await supabase
      .from("caixa_movimentos")
      .insert([{ user_id: userId, tipo, valor, descricao }]);
  },
};

const KpiService = {
  async unidades() {
    return await supabase.rpc("kpi_unidades");
  },
};

const NotificationService = {
  async buscarTudo() {
    const [ocorrencias, reservas, caixa] = await Promise.all([
      supabase
        .from("vw_ocorrencias_detalhes")
        .select("titulo, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("vw_reservas_detalhes")
        .select("area, data, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("vw_caixa_movimentos_publico")
        .select("tipo, valor, descricao, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const lista = [];

    if (ocorrencias.data) {
      ocorrencias.data.forEach((o) =>
        lista.push({
          tipo: "ocorrencia",
          titulo: "Nova Ocorrência",
          desc: o.titulo || "Sem título",
          data: new Date(o.created_at),
          icon: "fa-triangle-exclamation",
          color: "bg-notif-orange",
        })
      );
    }

    if (reservas.data) {
      reservas.data.forEach((r) => {
        const dataRef = r.created_at
          ? new Date(r.created_at)
          : new Date(r.data);
        lista.push({
          tipo: "reserva",
          titulo: "Reserva Confirmada",
          desc: `${r.area} - ${Utils.ajustarDataBR(r.data).toLocaleDateString(
            "pt-BR"
          )}`,
          data: dataRef,
          icon: "fa-calendar-check",
          color: "bg-notif-purple",
        });
      });
    }

    if (caixa.data) {
      caixa.data.forEach((c) => {
        const isEntrada = c.tipo === "entrada";
        lista.push({
          tipo: "caixa",
          titulo: isEntrada ? "Entrada no Caixa" : "Saída do Caixa",
          desc: `${Utils.formatBRL(c.valor)} - ${c.descricao}`,
          data: new Date(c.created_at),
          icon: isEntrada ? "fa-arrow-trend-up" : "fa-arrow-trend-down",
          color: isEntrada ? "bg-notif-green" : "bg-notif-blue",
        });
      });
    }

    return lista.sort((a, b) => b.data - a.data).slice(0, 20);
  },
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

    this.overlays.forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.close(overlay);
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const aberto = this.overlays.find((m) => m.classList.contains("active"));
      if (aberto) this.close(aberto);
    });

    document
      .querySelectorAll(".close-modal, .close-modal-reserva, .btn-outline")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          this.closeAll();
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
    const algumAberto = this.overlays.some((m) =>
      m.classList.contains("active")
    );
    if (!algumAberto) document.body.classList.remove("modal-open");
  },
  closeAll() {
    this.overlays.forEach((m) => m.classList.remove("active"));
    document.body.classList.remove("modal-open");
  },
};

// Controlador Principal da UI
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
    const icons = {
      success: "fa-check",
      error: "fa-xmark",
      info: "fa-info",
    };
    const titles = {
      success: "Sucesso",
      error: "Erro",
      info: "Informação",
    };

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    toast.innerHTML = `
      <div class="toast-icon-box">
        <i class="fa-solid ${icons[type] || "fa-bell"}"></i>
      </div>
      <div class="toast-content">
        <span class="toast-title">${titles[type]}</span>
        <span class="toast-msg">${Utils.safe(message)}</span>
      </div>
      <button class="toast-close" onclick="this.parentElement.remove()" aria-label="Fechar">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;

    toast.addEventListener("click", () => {
      toast.style.animation = "toastExit 0.3s forwards";
      setTimeout(() => toast.remove(), 300);
    });

    if (this.elements.toastContainer) {
      this.elements.toastContainer.appendChild(toast);
      setTimeout(() => {
        if (toast.isConnected) {
          toast.style.animation = "toastExit 0.5s forwards";
          setTimeout(() => toast.remove(), 500);
        }
      }, 4000);
    } else {
      console.warn("Toast container missing");
      alert(message);
    }
  },

  atualizarSidebar(perfil) {
    if (!perfil) return;
    const nome = Utils.safe(perfil.nome || "Usuário");

    if (this.elements.userName) this.elements.userName.innerText = nome;

    const cargoAmigavel =
      perfil.cargo === "Dono"
        ? "Dono"
        : perfil.cargo === "admin"
          ? "Síndico"
          : "Morador";
    if (this.elements.userRole)
      this.elements.userRole.innerText = cargoAmigavel;
    if (this.elements.userAvatar)
      this.elements.userAvatar.innerText = nome.charAt(0).toUpperCase();
  },

  async renderizarKPIs() {
    // STALE-WHILE-REVALIDATE: Mantém valor antigo visível até o novo chegar.

    // 1. Saldo (KPI)
    if (this.elements.kpiSaldo) {
      const { data, error } = await CaixaService.saldo();
      if (error) {
        this.elements.kpiSaldo.innerText = "Restrito";
        if (this.elements.kpiSaldoSub)
          this.elements.kpiSaldoSub.innerText = "Sem acesso";
      } else {
        this.elements.kpiSaldo.innerText = Utils.formatBRLInteiro(
          data?.saldo || 0
        );
        if (this.elements.kpiSaldoSub)
          this.elements.kpiSaldoSub.innerText = "Atualizado agora";
      }
    }

    // 2. Ocorrências (KPI)
    if (this.elements.kpiOcorrencias) {
      const { data, error } = await OcorrenciaService.listar();
      if (!error && data) {
        const abertas = data.filter(
          (o) => (o.status || "").toLowerCase() === "aberta"
        ).length;
        const urgentes = data.filter(
          (o) => (o.status || "").toLowerCase() === "urgente"
        ).length;
        this.elements.kpiOcorrencias.innerText = `${abertas} Abertas`;
        if (this.elements.kpiOcorrenciasSub)
          this.elements.kpiOcorrenciasSub.innerText = `${urgentes} Urgente`;
      }
    }

    // 3. Unidades (KPI)
    if (this.elements.kpiUnidades) {
      const { data } = await KpiService.unidades();
      if (data && data[0]) {
        const { total, ocupadas, vazias } = data[0];
        this.elements.kpiUnidades.innerText = `${ocupadas}/${total}`;
        if (this.elements.kpiUnidadesSub)
          this.elements.kpiUnidadesSub.innerText = `${vazias} Vazias`;
      }
    }
  },

  async renderizarAtividadesRecentes() {
    if (!this.elements.recentActivities) return;

    // Se já tiver cache, renderiza ele PRIMEIRO para evitar skeleton flicker
    const temCache = State.reservasCache && State.reservasCache.length > 0;

    if (!temCache) {
      // SKELETON (Só aparece se não tiver nada na memória)
      this.elements.recentActivities.innerHTML = Array(1)
        .fill(0)
        .map(
          () => `
        <div class="activity-item">
          <div class="skeleton skeleton-avatar" style="width:52px;height:52px;border-radius:16px;"></div>
          <div class="activity-info" style="flex:1">
            <div class="skeleton skeleton-text" style="width:50%"></div>
            <div class="skeleton skeleton-text" style="width:30%"></div>
          </div>
          <div class="skeleton skeleton-text" style="width:60px;height:24px;border-radius:20px;"></div>
        </div>`
        )
        .join("");
    } else {
      // Renderiza cache imediatamente
      this._renderActivitiesList(State.reservasCache);
    }

    // Busca dados frescos em background
    const { data, error } = await ReservaService.listar();

    if (error) {
      if (!temCache)
        this.elements.recentActivities.innerHTML = `<div class="activity-item">Erro ao carregar.</div>`;
      return;
    }

    // Atualiza cache e UI com dados novos
    State.reservasCache = data;
    this._renderActivitiesList(data);
  },

  _renderActivitiesList(data) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const futuras = (data || [])
      .map((r) => ({ ...r, dataObj: Utils.ajustarDataBR(r.data) }))
      .filter((r) => r.dataObj >= hoje)
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
    this.elements.recentActivities.innerHTML = futuras
      .map((r) => {
        const diffDias = Math.ceil((r.dataObj - hoje) / (1000 * 60 * 60 * 24));
        const quando = diffDias === 0 ? "Hoje" : `Em ${diffDias}d`;
        const linhaInfo = souDono
          ? Utils.safe(r.nome_morador || "Morador")
          : `Data: ${r.dataObj.toLocaleDateString("pt-BR")}`;

        return `
        <div class="activity-item">
          <div class="activity-icon bg-blue"><i class="fa-solid fa-calendar-day"></i></div>
          <div class="activity-info">
            <h4>Reserva: ${Utils.safe(r.area)}</h4>
            <p>${linhaInfo}</p>
          </div>
          <span class="activity-time">${quando}</span>
        </div>`;
      })
      .join("");
  },
};

// Controlador das Notificações
const UINotifications = {
  btn: document.getElementById("btn-notifications"),
  panel: document.getElementById("notifications-panel"),
  list: document.getElementById("notifications-list"),
  wrapper: document.querySelector(".notifications-wrapper"),
  overlay: null,
  isOpen: false,

  init() {
    if (!this.btn) return;

    if (!document.getElementById("blur-overlay")) {
      this.overlay = document.createElement("div");
      this.overlay.id = "blur-overlay";
      document.body.appendChild(this.overlay);
    } else {
      this.overlay = document.getElementById("blur-overlay");
    }

    this.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener("click", (e) => {
      if (
        this.isOpen &&
        !this.panel.contains(e.target) &&
        !this.btn.contains(e.target)
      ) {
        this.close();
      }
    });
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    this.isOpen = true;
    this.panel.classList.add("active");
    if (this.overlay) this.overlay.classList.add("active");
    if (this.wrapper) this.wrapper.classList.add("highlight-wrapper");
    this.render();
  },

  close() {
    this.isOpen = false;
    this.panel.classList.remove("active");
    if (this.overlay) this.overlay.classList.remove("active");
    if (this.wrapper) this.wrapper.classList.remove("highlight-wrapper");
  },

  async render() {
    // 1. Cache Instantâneo
    if (State.notificacoesCache) {
      this.renderHTML(State.notificacoesCache);
      return;
    }

    // 2. Skeleton + Fetch
    if (State.carregandoNotificacoes) return;
    State.carregandoNotificacoes = true;

    this.list.innerHTML = Array(1)
      .fill(0)
      .map(
        () => `
      <div class="notif-item">
        <div class="skeleton skeleton-avatar" style="border-radius:12px;"></div>
        <div class="notif-content">
          <div class="skeleton skeleton-text" style="width:70%"></div>
          <div class="skeleton skeleton-text" style="width:40%"></div>
        </div>
      </div>
    `
      )
      .join("");

    try {
      const itens = await NotificationService.buscarTudo();
      State.notificacoesCache = itens || [];
      this.renderHTML(State.notificacoesCache);
    } catch (err) {
      this.list.innerHTML = `<div style="padding:20px;text-align:center;color:#ef4444">Erro.</div>`;
    } finally {
      State.carregandoNotificacoes = false;
    }
  },

  renderHTML(itens) {
    if (itens.length === 0) {
      this.list.innerHTML = `<div style="padding:30px;text-align:center;color:#94a3b8">Nenhuma notificação.</div>`;
      return;
    }

    this.list.innerHTML = itens
      .map(
        (item) => `
      <div class="notif-item">
        <div class="notif-icon ${item.color}"><i class="fa-solid ${item.icon
          }"></i></div>
        <div class="notif-content">
          <span class="notif-title">${Utils.safe(item.titulo)}</span>
          <span class="notif-desc">${Utils.safe(item.desc)}</span>
          <span class="notif-time">${Utils.formatarTempoRelativo(
            item.data
          )}</span>
        </div>
      </div>
    `
      )
      .join("");
  },
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
      const inputData = document.getElementById("reserva-data");
      if (inputData) inputData.min = new Date().toISOString().split("T")[0];

      this.form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const area = document.getElementById("reserva-area")?.value;
        const data = document.getElementById("reserva-data")?.value;
        const meuId = State.usuarioLogado?.user_id;
        const tempId = `temp-${Date.now()}`;

        const reservaTemp = {
          id: tempId,
          area,
          data,
          user_id: meuId,
          nome_morador: State.usuarioLogado?.nome || "Você",
          created_at: new Date().toISOString(),
        };

        // Optimistic UI
        if (State.reservasCache) {
          State.reservasCache = [...State.reservasCache, reservaTemp];
        } else {
          State.reservasCache = [reservaTemp];
        }
        this.renderizarLista(State.reservasCache);

        ModalUX.close(this.modal);
        this.form.reset();

        const { error } = await ReservaService.criar(area, data);
        if (error) {
          State.reservasCache = State.reservasCache.filter(
            (r) => r.id !== tempId
          );
          await this.carregar();
          UI.showToast(
            error.code === "23505" ? "Data indisponível!" : error.message,
            "error"
          );
        } else {
          UI.showToast("Reserva confirmada!", "success");
          State.notificacoesCache = null; // Invalida notificações
        }
      });
    }

    if (this.btnConfirmDelete) {
      this.btnConfirmDelete.addEventListener("click", async () => {
        if (!State.reservaParaDeletar) return;

        const idParaDeletar = State.reservaParaDeletar;
        const reservaOriginal = State.reservasCache?.find(
          (r) => r.id === idParaDeletar
        );

        // Optimistic UI
        if (State.reservasCache) {
          State.reservasCache = State.reservasCache.filter(
            (r) => r.id !== idParaDeletar
          );
        } else {
          State.reservasCache = [];
        }
        this.renderizarLista(State.reservasCache);

        ModalUX.close(this.modalDelete);
        UI.showToast("Reserva cancelada.", "info");

        const { error } = await ReservaService.deletar(idParaDeletar);
        if (error) {
          if (reservaOriginal && State.reservasCache) {
            State.reservasCache = [...State.reservasCache, reservaOriginal];
          }
          await this.carregar();
          UI.showToast(error.message, "error");
        } else {
          State.notificacoesCache = null;
        }
      });
    }
  },

  renderizarLista(data) {
    if (!this.lista || !data) return;

    const souDono = isAdmin();
    const colCount = souDono ? 4 : 3;
    const meuId = State.usuarioLogado?.user_id;

    const thead = document.getElementById("thead-reservas");
    if (thead) {
      thead.innerHTML = souDono
        ? `<th>Data</th><th>Área</th><th>Reservado Por</th><th>Ações</th>`
        : `<th>Data</th><th>Área</th><th>Ações</th>`;
    }

    if (!data.length) {
      this.lista.innerHTML = `
        <tr class="no-reservas"><td colspan="${colCount}">
          <div style="display:flex;flex-direction:column;align-items:center;padding:20px;gap:10px">
            <i class="fa-regular fa-face-smile-beam" style="font-size:1.5rem;color:#2563eb"></i>
            <span>Nenhuma reserva futura.</span>
          </div>
        </td></tr>`;
      return;
    }

    this.lista.innerHTML = data
      .map((r) => {
        const dataObj = Utils.ajustarDataBR(r.data);
        const podeCancelar =
          souDono || (meuId && r.user_id && r.user_id === meuId);

        const btn = podeCancelar
          ? `<button class="action-btn" onclick="deletarReserva(${r.id})" style="color:#ef4444"><i class="fa-regular fa-trash-can"></i></button>`
          : `<button class="action-btn action-btn-locked"><i class="fa-solid fa-lock"></i></button>`;

        const cols = souDono
          ? `<td data-label="Data" class="td-destaque">${dataObj.toLocaleDateString(
            "pt-BR"
          )}</td>
           <td data-label="Área" class="td-titulo">${Utils.safe(r.area)}</td>
           <td data-label="Reservado Por" class="td-texto">${Utils.safe(
            r.nome_morador
          )}</td>
           <td class="td-acao">${btn}</td>`
          : `<td data-label="Data" class="td-destaque">${dataObj.toLocaleDateString(
            "pt-BR"
          )}</td>
           <td data-label="Área" class="td-titulo">${Utils.safe(r.area)}</td>
           <td class="td-acao">${btn}</td>`;

        return `<tr>${cols}</tr>`;
      })
      .join("");
  },

  async carregar() {
    if (!this.lista || State.carregandoReservas) return;
    State.carregandoReservas = true;

    const souDono = isAdmin();
    const colCount = souDono ? 4 : 3;

    // SKELETON apenas se a lista estiver vazia (primeira carga real)
    if (!this.lista.children.length) {
      this.lista.innerHTML = Array(1)
        .fill(0)
        .map(
          () => `
        <tr>
          <td><div class="skeleton skeleton-text" style="width:80px"></div></td>
          <td><div class="skeleton skeleton-text" style="width:120px"></div></td>
          ${souDono
              ? '<td><div class="skeleton skeleton-text" style="width:100px"></div></td>'
              : ""
            }
          <td><div class="skeleton skeleton-text" style="width:30px"></div></td>
        </tr>
      `
        )
        .join("");
    }

    try {
      const { data, error } = await ReservaService.listar();
      if (error) throw error;

      State.reservasCache = data || [];
      this.renderizarLista(State.reservasCache);
    } catch (e) {
      this.lista.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center">Erro.</td></tr>`;
    } finally {
      State.carregandoReservas = false;
    }
  },
};

// Controlador de Ocorrências
const UIOcorrencias = {
  lista: document.getElementById("lista-ocorrencias"),
  modal: document.getElementById("modal-ocorrencia"),
  form: document.getElementById("form-ocorrencia"),
  modalDelete: document.getElementById("modal-confirm-delete-ocorrencia"),
  btnConfirmDelete: document.getElementById("btn-confirm-delete-ocorrencia"),

  init() {
    const btns = [
      document.getElementById("btn-nova-ocorrencia"),
      document.getElementById("btn-nova-ocorrencia-2"),
    ];
    btns.forEach((b) =>
      b?.addEventListener("click", () => ModalUX.open(this.modal))
    );

    if (this.form) {
      this.form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const t = document.getElementById("oc-titulo")?.value;
        const d = document.getElementById("oc-descricao")?.value;

        const tempId = `temp-${Date.now()}`;
        const ocTemp = {
          id: tempId,
          titulo: t,
          descricao: d,
          status: "aberta",
          created_at: new Date().toISOString(),
          user_id: State.usuarioLogado?.user_id,
          minha: true,
          registrador_nome: State.usuarioLogado?.nome,
          registrador_celular: State.usuarioLogado?.celular,
        };

        // Optimistic UI
        if (State.ocorrenciasCache) {
          State.ocorrenciasCache = [ocTemp, ...State.ocorrenciasCache];
        } else {
          State.ocorrenciasCache = [ocTemp];
        }
        this.renderizarLista(State.ocorrenciasCache);

        ModalUX.close(this.modal);
        this.form.reset();
        UI.showToast("Registrada!", "success");

        const { error } = await OcorrenciaService.criar(t, d);
        if (error) {
          State.ocorrenciasCache = State.ocorrenciasCache.filter(
            (o) => o.id !== tempId
          );
          await this.carregar();
          UI.showToast(error.message, "error");
        } else {
          State.notificacoesCache = null; // Invalida notificações
        }
      });
    }

    if (this.btnConfirmDelete) {
      this.btnConfirmDelete.addEventListener("click", async () => {
        if (!State.ocorrenciaParaDeletar) return;

        const idParaDeletar = State.ocorrenciaParaDeletar;
        const ocorrenciaOriginal = State.ocorrenciasCache?.find(
          (o) => o.id === idParaDeletar
        );

        // Optimistic UI
        if (State.ocorrenciasCache) {
          State.ocorrenciasCache = State.ocorrenciasCache.filter(
            (o) => o.id !== idParaDeletar
          );
        } else {
          State.ocorrenciasCache = [];
        }
        this.renderizarLista(State.ocorrenciasCache);

        ModalUX.close(this.modalDelete);
        UI.showToast("Excluída.", "info");

        const { error } = await OcorrenciaService.deletar(idParaDeletar);
        if (error) {
          if (ocorrenciaOriginal && State.ocorrenciasCache) {
            State.ocorrenciasCache = [
              ocorrenciaOriginal,
              ...State.ocorrenciasCache,
            ];
          }
          await this.carregar();
          UI.showToast(error.message, "error");
        } else {
          State.notificacoesCache = null;
        }
      });
    }
  },

  renderizarLista(data) {
    if (!this.lista || !data) return;

    const souAdmin = isAdmin();
    const tabela = document.querySelector(".tabela-ocorrencias");
    const thead = tabela?.querySelector("thead tr");

    if (thead) {
      if (souAdmin) {
        tabela.classList.remove("morador-view");
        thead.innerHTML = `<th>Data</th><th>Ocorrência</th><th>Morador</th><th>Contato</th><th>Status</th><th>Ações</th>`;
      } else {
        tabela.classList.add("morador-view");
        thead.innerHTML = `<th>Data</th><th>Ocorrência</th><th>Status</th><th>Ações</th>`;
      }
    }

    if (!data.length) {
      const colspan = souAdmin ? 6 : 4;
      this.lista.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center">Nenhuma ocorrência.</td></tr>`;
      return;
    }

    this.lista.innerHTML = data
      .map((o) => {
        const d = new Date(o.created_at).toLocaleDateString("pt-BR");
        const podeExcluir = souAdmin || o.minha;

        const btn = podeExcluir
          ? `<button class="action-btn" onclick="deletarOcorrencia(${o.id})" style="color:#ef4444"><i class="fa-regular fa-trash-can"></i></button>`
          : `<button class="action-btn action-btn-locked"><i class="fa-solid fa-lock"></i></button>`;

        if (souAdmin) {
          return `<tr>
          <td data-label="Data" class="td-destaque">${d}</td>
          <td data-label="Ocorrência" class="td-titulo">${Utils.safe(
            o.titulo
          )}</td>
          <td data-label="Morador" class="td-texto">${Utils.safe(
            o.registrador_nome
          )}</td>
          <td data-label="Contato" class="td-texto">${Utils.safe(
            o.registrador_celular
          )}</td>
          <td data-label="Status" class="td-texto" style="text-transform:capitalize">${Utils.safe(
            o.status
          )}</td>
          <td class="td-acao">${btn}</td>
        </tr>`;
        } else {
          return `<tr>
          <td data-label="Data" class="td-destaque">${d}</td>
          <td data-label="Ocorrência" class="td-titulo">${Utils.safe(
            o.titulo
          )}</td>
          <td data-label="Status" class="td-texto" style="text-transform:capitalize">${Utils.safe(
            o.status
          )}</td>
          <td class="td-acao">${btn}</td>
        </tr>`;
        }
      })
      .join("");
  },

  async carregar() {
    if (!this.lista || State.carregandoOcorrencias) return;
    State.carregandoOcorrencias = true;

    const souAdmin = isAdmin();

    if (!this.lista.children.length) {
      this.lista.innerHTML = Array(1)
        .fill(0)
        .map(
          () => `
        <tr>
          <td><div class="skeleton skeleton-text" style="width:80px"></div></td>
          <td><div class="skeleton skeleton-text" style="width:150px"></div></td>
          ${souAdmin
              ? `<td><div class="skeleton skeleton-text" style="width:100px"></div></td>
             <td><div class="skeleton skeleton-text" style="width:100px"></div></td>`
              : ""
            }
          <td><div class="skeleton skeleton-text" style="width:70px"></div></td>
          <td><div class="skeleton skeleton-text" style="width:30px"></div></td>
        </tr>
      `
        )
        .join("");
    }

    try {
      const { data, error } = await OcorrenciaService.listar();
      if (error) throw error;

      State.ocorrenciasCache = data || [];
      this.renderizarLista(State.ocorrenciasCache);
    } catch (e) {
      const colspan = isAdmin() ? 6 : 4;
      this.lista.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center">Erro.</td></tr>`;
    } finally {
      State.carregandoOcorrencias = false;
    }
  },
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
        // CACHE: Usa memória se tiver
        if (State.caixaCache && State.caixaCache.length > 0) {
          this.renderizarLista(State.caixaCache);
        } else {
          this.carregarExtrato();
        }
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
          State.caixaCache = null; // Invalida cache
          State.notificacoesCache = null;
          ModalUX.close(this.modal);
        }
        btn.innerText = original;
        btn.disabled = false;
      });
    }
  },

  async carregarExtrato() {
    if (!this.listaHistorico || State.carregandoCaixa) return;
    State.carregandoCaixa = true;

    if (!this.listaHistorico.children.length) {
      this.listaHistorico.innerHTML = Array(1)
        .fill(0)
        .map(
          () => `
        <tr>
            <td><div class="skeleton skeleton-text" style="width:80px"></div></td>
            <td><div class="skeleton skeleton-text" style="width:60px"></div></td>
            <td><div class="skeleton skeleton-text" style="width:100px"></div></td>
            <td><div class="skeleton skeleton-text" style="width:150px"></div></td>
        </tr>
        `
        )
        .join("");
    }

    try {
      const { data, error } = await CaixaService.listarPublico();
      if (error) throw error;

      State.caixaCache = data || [];
      this.renderizarLista(State.caixaCache);
    } catch (err) {
      this.listaHistorico.innerHTML = `<tr><td colspan="4" style="text-align:center">Erro.</td></tr>`;
    } finally {
      State.carregandoCaixa = false;
    }
  },

  renderizarLista(data) {
    if (!data?.length) {
      this.listaHistorico.innerHTML = `<tr><td colspan="4" style="text-align:center">Sem movimentações.</td></tr>`;
      return;
    }

    this.listaHistorico.innerHTML = data
      .map((m) => {
        const d = new Date(m.created_at).toLocaleDateString("pt-BR");
        const tipo = m.tipo === "entrada" ? "Entrada" : "Saída";

        return `<tr>
          <td data-label="Data" class="td-destaque"><strong>${d}</strong></td>
          <td data-label="Tipo" class="td-texto">${tipo}</td>
          <td data-label="Valor" class="td-titulo"><strong>${Utils.formatBRL(
          m.valor
        )}</strong></td>
          <td data-label="Descrição" class="td-texto" style="vertical-align: middle;">${Utils.safe(
          m.descricao
        )}</td>
        </tr>`;
      })
      .join("");
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
    const inputCel = document.getElementById("celular");
    inputCel?.addEventListener("input", (e) => {
      let v = e.target.value.replace(/\D/g, "").substring(0, 11);
      v = v.replace(/^(\d{2})(\d)/g, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
      e.target.value = v;
    });

    document.getElementById("unidade-bloco")?.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    this.form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!State.idEditando || !isAdmin()) return;

      const btn = this.form.querySelector("button");
      btn.disabled = true;

      const unidade = `${document.getElementById("unidade-num").value
        } - Bloco ${document.getElementById("unidade-bloco").value}`;

      const dados = {
        nome: document.getElementById("nome").value,
        celular: document.getElementById("celular").value,
        tipo: document.getElementById("tipo").value,
        status: document.getElementById("status").value,
        unidade,
        img: `https://ui-avatars.com/api/?name=${encodeURIComponent(
          document.getElementById("nome").value
        )}&background=random`,
      };

      await MoradorService.salvar(dados, State.idEditando);
      UI.showToast("Salvo!");
      ModalUX.close(this.modal);
      this.carregar();
      btn.disabled = false;
    });

    this.tabela?.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-editar");
      const btnDel = e.target.closest(".btn-excluir");

      if (btnEdit) {
        const m = State.moradoresCache.find(
          (x) => x.id === Number(btnEdit.dataset.id)
        );
        if (m) {
          State.idEditando = m.id;
          this.preencherModal(m);
          ModalUX.open(this.modal);
        }
      }
      if (btnDel) {
        State.emailParaDeletar = btnDel.dataset.email;
        ModalUX.open(this.modalDelete);
      }
    });

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
    emailInput.disabled = true;
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
    if (this.tabela && !this.tabela.children.length) {
      this.tabela.innerHTML = Array(1)
        .fill(0)
        .map(
          () => `
            <tr>
              <td>
                <div class="user-cell">
                  <div class="skeleton skeleton-avatar"></div>
                  <div>
                    <div class="skeleton skeleton-text" style="width:100px"></div>
                    <div class="skeleton skeleton-text" style="width:60px"></div>
                  </div>
                </div>
              </td>
              <td><div class="skeleton skeleton-text" style="width:50px"></div></td>
              <td><div class="skeleton skeleton-text" style="width:120px"></div></td>
              <td><div class="skeleton skeleton-text" style="width:80px"></div></td>
              <td><div class="skeleton skeleton-text" style="width:30px"></div></td>
            </tr>
          `
        )
        .join("");
    }

    const { data } = await MoradorService.listarTodos();
    State.moradoresCache = data || [];
    this.render();
  },

  render() {
    if (!this.tabela) return;
    const podeEditar = isAdmin();

    this.tabela.innerHTML = State.moradoresCache
      .map((m) => {
        const badge = m.status === "ok" ? `<span class="status-badge status-ok">Em dia</span>` : `<span class="status-badge status-late">Atrasado</span>`;
        const actions = podeEditar
          ? `<button class="action-btn btn-editar" data-id="${m.id}"><i class="fa-regular fa-pen-to-square"></i></button>
           <button class="action-btn btn-excluir" data-email="${m.email}" style="color:#ef4444"><i class="fa-regular fa-trash-can"></i></button>`
          : `<button class="action-btn action-btn-locked"><i class="fa-solid fa-lock"></i></button>`;

        return `<tr>
        <td>
          <div class="user-cell">
            <img src="${m.img || `https://ui-avatars.com/api/?name=${m.nome}`}" class="user-avatar" />
            <div><strong class="td-titulo">${Utils.safe(
          m.nome
        )}</strong><br/><small>${Utils.safe(m.tipo)}</small></div>
          </div>
        </td>
        <td class="td-texto"><strong>${Utils.safe(m.unidade)}</strong></td>
        <td class="td-texto">${Utils.safe(m.celular)}</td>
        <td>${badge}</td>
        <td class="td-acao">${actions}</td>
      </tr>`;
      })
      .join("");
  },
};

/**
 * ============================================================================
 * 5. MAIN INIT & REALTIME
 * ============================================================================
 */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const auth = await MoradorService.buscarPerfilUsuario();
    if (!auth) {
      window.location.href = "../auth/login.html";
      return;
    }

    State.usuarioLogado = auth.perfil;
    UI.atualizarSidebar(State.usuarioLogado);

    ModalUX.init();
    UIReserva.init();
    UIOcorrencias.init();
    UICaixa.init();
    UIMoradores.init();
    UINotifications.init();

    await Promise.all([
      UI.renderizarKPIs(),
      UI.renderizarAtividadesRecentes(),
      UIMoradores.carregar(),
    ]);

    const channel = supabase.channel("dashboard-changes");
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ocorrencias" },
        () => {
          UI.renderizarKPIs();
          State.notificacoesCache = null; // Invalida
          if (
            document
              .getElementById("view-ocorrencias")
              .classList.contains("active")
          )
            UIOcorrencias.carregar();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservas" },
        () => {
          UI.renderizarAtividadesRecentes();
          State.notificacoesCache = null; // Invalida
          if (
            document
              .getElementById("view-reservas")
              .classList.contains("active")
          )
            UIReserva.carregar();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "caixa_movimentos" },
        () => {
          UI.renderizarKPIs();
          State.caixaCache = null; // Invalida
          State.notificacoesCache = null; // Invalida
          if (UICaixa.modalHistorico.classList.contains("active"))
            UICaixa.carregarExtrato();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "moradores" },
        () => {
          UI.renderizarKPIs();
          if (
            document
              .getElementById("view-moradores")
              .classList.contains("active")
          )
            UIMoradores.carregar();
        }
      )
      .subscribe();

    console.log("🚀 Dashboard sincronizado.");
  } catch (err) {
    console.error("Fatal:", err);
  }

  const btnLogout = document.querySelector(".menu-item.logout, #btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", async (e) => {
      e.preventDefault();
      await MoradorService.logout();
    });
  }

  document.querySelectorAll(".sidebar-menu .menu-item").forEach((link) => {
    link.addEventListener("click", async (e) => {
      if (link.classList.contains("logout")) return;

      e.preventDefault();
      const targetId = link.dataset.view;

      document
        .querySelectorAll(".menu-item")
        .forEach((l) => l.classList.remove("active"));
      link.classList.add("active");

      document
        .querySelectorAll(".view-section")
        .forEach((s) => s.classList.remove("active"));
      document.getElementById(targetId).classList.add("active");

      document.querySelector(".top-bar .page-title").innerText =
        link.dataset.title;

      if (targetId === "view-reservas") {
        if (State.reservasCache) UIReserva.renderizarLista(State.reservasCache);
        else await UIReserva.carregar();
      }

      if (targetId === "view-ocorrencias") {
        if (State.ocorrenciasCache)
          UIOcorrencias.renderizarLista(State.ocorrenciasCache);
        else await UIOcorrencias.carregar();
      }
    });
  });

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