document.addEventListener("DOMContentLoaded", async () => {
    // ==========================================
    // 0. CONFIGURAÇÃO & SERVIÇOS
    // ==========================================
    const SUPABASE_URL = "https://dtfzvbtodlyyfokfgllv.supabase.co";
    const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0Znp2YnRvZGx5eWZva2ZnbGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDE0NDUsImV4cCI6MjA4MjM3NzQ0NX0.L6qGW1Bl8k0eQhvJL_IvGE3q7yVPGPELL2beiDLhQ_Y";
    
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Serviço de Dados (Camada de API)
    const MoradorService = {
        async buscarPerfilUsuario() {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return null;

            // Busca perfil usando user_id (mais seguro)
            const { data } = await supabase
                .from('moradores')
                .select('*')
                .eq('user_id', session.user.id)
                .maybeSingle();
            
            return { session, perfil: data };
        },

        async listarTodos() {
            // Busca todos ordenados pelo ID
            return await supabase
                .from("moradores")
                .select("*")
                .order("id", { ascending: false });
        },

        async salvar(dados, id = null) {
            // Edição via RPC (Seguro)
            if (id) {
                return await supabase.rpc('atualizar_morador_completo', {
                    email_alvo: dados.email,
                    novo_nome: dados.nome,
                    novo_celular: dados.celular,
                    novo_tipo: dados.tipo,
                    nova_unidade: dados.unidade,
                    novo_status: dados.status,
                    nova_img: dados.img
                });
            } else {
                return { error: { message: "Para criar novos moradores, use a página de Cadastro." } };
            }
        },

        async excluir(email) {
            return await supabase.rpc('excluir_conta_completa', { email_alvo: email });
        },

        async logout() {
            await supabase.auth.signOut();
            window.location.href = '../auth/login.html';
        }
    };

    // ==========================================
    // 1. ESTADO GLOBAL
    // ==========================================
    const State = {
        usuarioLogado: null,
        moradoresCache: [],
        idEditando: null,
        emailParaDeletar: null
    };

    // ==========================================
    // 2. ELEMENTOS DA UI
    // ==========================================
    const UI = {
        tabela: document.getElementById("lista-moradores"),
        modalCadastro: document.getElementById("modal-novo-morador"),
        modalExclusao: document.getElementById("modal-confirm-delete"),
        formMorador: document.getElementById("form-morador"),
        btnConfirmDelete: document.getElementById("btn-confirm-delete"),
        btnLogout: document.querySelector('.logout'),
        toastContainer: document.getElementById('toast-container'),
        
        // Sidebar
        userAvatar: document.getElementById("user-avatar"),
        userName: document.getElementById("user-name"),
        userRole: document.getElementById("user-role"),
        
        // Navegação
        menuLinks: document.querySelectorAll(".sidebar-menu .menu-item"),
        viewSections: document.querySelectorAll(".view-section"),
        
        // Inputs
        inputNome: document.getElementById("nome"),
        inputEmail: document.getElementById("email-novo"),
        inputCelular: document.getElementById("celular"),
        inputTipo: document.getElementById("tipo"),
        inputUnidadeNum: document.getElementById("unidade-num"),
        inputUnidadeBloco: document.getElementById("unidade-bloco"),
        inputStatus: document.getElementById("status"),

        showToast(message, type = 'success') {
            const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `<i class="fa-solid ${icons[type]}"></i><span>${message}</span>`;
            if(this.toastContainer) {
                this.toastContainer.appendChild(toast);
                setTimeout(() => {
                    toast.style.animation = 'fadeOut 0.5s forwards';
                    setTimeout(() => toast.remove(), 500);
                }, 4000);
            } else { alert(message); }
        },

        renderizarTabela(moradores, podeEditar) {
            this.tabela.innerHTML = "";
            if (!moradores || moradores.length === 0) {
                this.tabela.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Nenhum registro encontrado.</td></tr>';
                return;
            }
            moradores.forEach(m => {
                const tr = document.createElement("tr");
                const badgeClass = m.status === "ok" ? "status-ok" : "status-late";
                const badgeText = m.status === "ok" ? "Em dia" : "Atrasado";
                const actions = podeEditar ? `
                    <button class="action-btn btn-editar" data-id="${m.id}"><i class="fa-regular fa-pen-to-square"></i></button>
                    <button class="action-btn btn-excluir" data-email="${m.email}" style="color: #ef4444;"><i class="fa-regular fa-trash-can"></i></button>
                ` : `<span style="opacity:0.5" title="Leitura"><i class="fa-solid fa-lock"></i></span>`;

                tr.innerHTML = `
                    <td><div class="user-cell"><img src="${m.img || 'https://ui-avatars.com/api/?name=User'}" class="user-avatar"><div><strong>${m.nome}</strong><br><small>${m.tipo}</small></div></div></td>
                    <td><strong>${m.unidade}</strong></td>
                    <td>${m.celular}</td>
                    <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
                    <td>${actions}</td>
                `;
                this.tabela.appendChild(tr);
            });
            const kpi = document.querySelector(".stat-card:nth-child(3) .stat-value");
            if(kpi) kpi.innerText = `${moradores.length}/50`;
        },

        atualizarSidebar(perfil) {
            if (!perfil) return;
            const nome = perfil.nome || "Usuário";
            this.userName.innerText = nome;
            const cargoAmigavel = (perfil.cargo === 'Dono' || perfil.cargo === 'admin') ? 'Síndico' : 'Morador';
            this.userRole.innerText = cargoAmigavel;
            this.userAvatar.innerText = nome.charAt(0).toUpperCase();
        },
        
        preencherModal(morador) {
            this.inputNome.value = morador.nome;
            this.inputEmail.value = morador.email;
            this.inputEmail.disabled = true;
            this.inputCelular.value = morador.celular;
            this.inputTipo.value = morador.tipo;
            this.inputStatus.value = morador.status;
            if (morador.unidade && morador.unidade.includes(" - Bloco ")) {
                const [num, bloco] = morador.unidade.split(" - Bloco ");
                this.inputUnidadeNum.value = num;
                this.inputUnidadeBloco.value = bloco;
            } else {
                this.inputUnidadeNum.value = morador.unidade;
                this.inputUnidadeBloco.value = "";
            }
        }
    };

    // ==========================================
    // 3. INICIALIZAÇÃO
    // ==========================================
    try {
        const authData = await MoradorService.buscarPerfilUsuario();
        if (!authData) { window.location.href = '../auth/login.html'; return; }

        State.usuarioLogado = authData.perfil;
        if (!State.usuarioLogado) {
            UI.showToast("Perfil em criação... aguarde.", "info");
        } else {
            UI.atualizarSidebar(State.usuarioLogado);
        }

        const souDono = State.usuarioLogado?.cargo === 'Dono' || State.usuarioLogado?.cargo === 'admin';

        const { data, error } = await MoradorService.listarTodos();
        if (error) throw new Error(error.message);
        
        State.moradoresCache = data;
        UI.renderizarTabela(data, souDono);

    } catch (err) {
        console.error("Erro Fatal:", err);
        UI.showToast("Erro ao carregar: " + err.message, "error");
    }

    // ==========================================
    // 4. EVENTOS (CONTROLLERS)
    // ==========================================
    
    // AQUI ESTAVA FALTANDO: NAVEGAÇÃO DO MENU LATERAL
    UI.menuLinks.forEach((link) => {
        link.addEventListener("click", (e) => {
            if (link.classList.contains("logout")) return;
            e.preventDefault();

            UI.menuLinks.forEach((l) => l.classList.remove("active"));
            link.classList.add("active");

            const spanText = link.querySelector("span").innerText;
            // Mapeia o texto do menu para o ID da section no HTML
            let targetId = "view-dashboard";
            if (spanText.includes("Moradores")) targetId = "view-moradores";
            if (spanText.includes("Visão Geral")) targetId = "view-dashboard";
            if (spanText.includes("Relatórios")) targetId = "view-dashboard"; // Placeholder

            UI.viewSections.forEach((s) => {
                s.classList.remove("active");
                if (s.id === targetId) s.classList.add("active");
            });
        });
    });

    if(UI.btnLogout) UI.btnLogout.addEventListener('click', (e) => {
        e.preventDefault();
        MoradorService.logout();
    });

    document.querySelectorAll('.close-modal, .btn-outline').forEach(btn => {
        btn.addEventListener('click', () => {
            UI.modalCadastro.classList.remove("active");
            UI.modalExclusao.classList.remove("active");
        });
    });

    UI.tabela.addEventListener('click', (e) => {
        const btnEditar = e.target.closest('.btn-editar');
        const btnExcluir = e.target.closest('.btn-excluir');

        if (btnEditar) {
            const id = parseInt(btnEditar.dataset.id);
            const morador = State.moradoresCache.find(m => m.id === id);
            if (morador) {
                State.idEditando = id;
                UI.preencherModal(morador);
                UI.modalCadastro.classList.add("active");
                document.querySelector(".modal-header h3").innerText = "Editar Morador";
            }
        }

        if (btnExcluir) {
            State.emailParaDeletar = btnExcluir.dataset.email;
            UI.modalExclusao.classList.add("active");
        }
    });

    UI.formMorador.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = UI.formMorador.querySelector("button");
        const txtOriginal = btn.innerText;
        btn.innerText = "Processando...";
        btn.disabled = true;

        const dados = {
            nome: UI.inputNome.value,
            email: UI.inputEmail.value.toLowerCase().trim(),
            celular: UI.inputCelular.value,
            tipo: UI.inputTipo.value,
            status: UI.inputStatus.value,
            unidade: `${UI.inputUnidadeNum.value} - Bloco ${UI.inputUnidadeBloco.value.toUpperCase()}`,
            img: `https://ui-avatars.com/api/?name=${UI.inputNome.value}&background=random`
        };

        const { error } = await MoradorService.salvar(dados, State.idEditando);

        if (error) {
            UI.showToast(error.message, "error");
        } else {
            UI.showToast("Salvo com sucesso!", "success");
            UI.modalCadastro.classList.remove("active");
            const { data } = await MoradorService.listarTodos();
            State.moradoresCache = data;
            const ehDono = State.usuarioLogado?.cargo === 'Dono' || State.usuarioLogado?.cargo === 'admin';
            UI.renderizarTabela(data, ehDono);
        }
        btn.innerText = txtOriginal;
        btn.disabled = false;
    });

    UI.btnConfirmDelete.addEventListener('click', async () => {
        if (!State.emailParaDeletar) return;
        const btn = UI.btnConfirmDelete;
        btn.innerText = "Excluindo...";
        btn.disabled = true;
        const { error } = await MoradorService.excluir(State.emailParaDeletar);

        if (error) {
            UI.showToast("Erro ao excluir: " + error.message, "error");
        } else {
            UI.showToast("Morador removido.", "success");
            UI.modalExclusao.classList.remove("active");
            const { data } = await MoradorService.listarTodos();
            State.moradoresCache = data;
            const ehDono = State.usuarioLogado?.cargo === 'Dono' || State.usuarioLogado?.cargo === 'admin';
            UI.renderizarTabela(data, ehDono);
        }
        btn.innerText = "Sim, Excluir";
        btn.disabled = false;
    });

    UI.inputCelular.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, "");
        v = v.substring(0, 11);
        v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
        v = v.replace(/(\d{5})(\d)/, "$1-$2");
        e.target.value = v;
    });
    
    UI.inputUnidadeBloco.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });
});