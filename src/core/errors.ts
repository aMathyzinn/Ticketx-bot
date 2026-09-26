export class DomainError extends Error {
  public constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ActiveTicketExistsError extends DomainError {
  public constructor() {
    super('Você já possui um ticket ativo nesta categoria.', 'ACTIVE_TICKET_EXISTS');
  }
}

export class NotFoundError extends DomainError {
  public constructor(entity: string) {
    super(`${entity} não encontrado.`, 'NOT_FOUND');
  }
}

export class ForbiddenError extends DomainError {
  public constructor(message = 'Você não tem permissão para realizar esta ação.') {
    super(message, 'FORBIDDEN');
  }
}
