/** HTTP status codes used across controllers and middleware. */
enum ResponseStatus {
	OK = 200,
	CREATED = 201,
	NO_CONTENT = 204,
	BAD_REQUEST = 400,
	UNAUTHORIZED = 401,
	FORBIDDEN = 403,
	NOT_FOUND = 404,
	CONFLICT = 409,
	UNPROCESSABLE = 422,
	TOO_MANY_REQUESTS = 429,
	SERVICE_UNAVAILABLE = 503,
	INTERNAL_ERROR = 500,
}

export default ResponseStatus;
