-- Escrita à mão (M1-08): fecha a corrida entre um login em andamento e a suspensão da conta.
-- Sem isto, o login podia checar "não suspensa", a suspensão apagar as sessões (ainda sem a nova) e o
-- login então gravar a sessão: uma sessão sobreviveria à suspensão. O gatilho serializa as duas
-- operações pela linha do usuário (suspendUser a trava com FOR UPDATE; aqui entra FOR KEY SHARE, que
-- conflita com ele) e recusa a sessão nova quando há suspensão ativa. Cada instrução do plpgsql lê um
-- instantâneo novo (READ COMMITTED), então depois da espera enxerga a suspensão já confirmada. Sem
-- advisory lock. Os caminhos normais recusam antes (gancho do Better Auth); isto é a última barreira.
CREATE FUNCTION session_refuse_suspended() RETURNS trigger AS $$
BEGIN
	PERFORM 1 FROM "user" WHERE id = NEW.user_id FOR KEY SHARE;
	IF EXISTS (SELECT 1 FROM user_suspension WHERE user_id = NEW.user_id AND lifted_at IS NULL) THEN
		RAISE EXCEPTION 'account_suspended' USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER session_refuse_suspended BEFORE INSERT ON "session" FOR EACH ROW EXECUTE FUNCTION session_refuse_suspended();
