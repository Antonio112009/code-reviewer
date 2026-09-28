---
name: Spring Boot integration tests
description: Spring test defects — @Transactional tests with a real server not rolling back, rollbacks hiding flush-time failures, context-cache explosions from mocks and properties, an embedded database replacing the real one in @DataJpaTest and slices without security config.
priority: 52
activation:
  stack: [framework.spring]
  content:
    - '@(?:SpringBootTest|DataJpaTest|WebMvcTest|WebFluxTest|JdbcTest|MockBean|SpyBean|MockitoBean|MockitoSpyBean|DirtiesContext|AutoConfigureTestDatabase|ServiceConnection|Sql)\b'
    - '\b(?:TestRestTemplate|WebTestClient|RestTestClient|MockMvc)\b'
  examples:
    - '@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)'
    - 'MockMvc mockMvc;'
sources:
  - https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html
  - https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html
---
- **@Transactional with a real server**: with `RANDOM_PORT`/`DEFINED_PORT`, requests run on server threads in their own transactions → server writes aren't rolled back and test-inserted data is invisible to the server. Fix: commit test data; clean up explicitly.
- **Rollback hides flush errors**: `@Transactional` tests that never flush skip SQL constraint checks, `@Version` conflicts and lazy-loading failures that production hits at commit. Fix: `flush()` and `clear()` the `EntityManager` before asserting.
- **Context cache explosion**: every distinct set of `@MockitoBean`/`@MockBean`, `@TestPropertySource`, profiles or `@DirtiesContext` builds another cached `ApplicationContext` → slow suites and DB connections held by idle contexts. Fix: shared mock configurations, avoid `@DirtiesContext`.
- **Embedded DB in @DataJpaTest**: `@AutoConfigureTestDatabase` replaces the DataSource with an embedded database by default → native SQL, JSON, locking and dialect bugs pass in tests. Fix: Testcontainers with `@ServiceConnection` (Boot 3.1+) and `replace = NONE`.
- **Slices without security**: `@WebMvcTest` loads only MVC components; security configuration that isn't imported leaves the real rules untested. Fix: `@Import` the security config and test with `@WithMockUser`.
